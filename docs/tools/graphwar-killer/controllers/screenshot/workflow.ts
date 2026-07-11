/** 管理截图输入和舞台像素坐标，避免页面直接承载浏览器 I/O 细节。 */
import { ref, type Ref } from "vue";

import { clampPixelPointToCanvas } from "../../core/geometry";
import { clampNumber } from "../../core/numbers";
import { graphwarToolDefaults } from "../../core/tool/defaults";
import { createPixelPoint, type PixelPoint } from "../../core/types";
import type { GraphwarKillerLocale } from "../../locale-types";

/** 页面把业务清理挂在这些回调上，截图 Module 本身只负责图片状态落地。 */
interface GraphwarScreenshotWorkflowOptions {
  /** 图片状态和截屏错误的本地化文案。 */
  imageText: GraphwarKillerLocale["status"]["image"];
  /** 新截图应用后调用；页面在这里清路径、识别结果和业务缓存。 */
  onImageApplied?: () => void;
  /** 图片元素完成加载后调用；页面在这里触发自动识别。 */
  onImageLoaded?: () => void;
}

/** 截图 Module 暴露给页面的稳定 Interface。 */
export interface GraphwarScreenshotWorkflowController {
  /** 应用由非文件输入生成的图片 URL，例如 Agent 的 770x450 状态画布。 */
  applyGeneratedImage: (url: string, name: string, width: number, height: number) => void;
  /** 通过浏览器截屏 API 读取截图。 */
  captureScreenImage: () => Promise<void>;
  /** 读取当前图片元素像素。 */
  getImageDataFromCurrentImage: () => ImageData | undefined;
  /** 把浏览器事件转换为截图像素点。 */
  getImagePointFromEvent: (event: MouseEvent) => PixelPoint | undefined;
  /** 拖拽图片入口。 */
  handleDrop: (event: DragEvent) => void;
  /** 图片元素 load 入口。 */
  handleImageLoad: () => void;
  /** 文件输入入口。 */
  handleImageUpload: (event: Event) => void;
  /** 使已经开始但尚未落地的用户截图读取失效。 */
  invalidatePendingUserImageRequests: () => void;
  /** 粘贴图片入口。 */
  handlePaste: (event: ClipboardEvent) => void;
  /** 当前图片高度。 */
  imageHeight: Ref<number>;
  /** 当前图片名或虚拟名称。 */
  imageName: Ref<string>;
  /** 图片 DOM 引用。 */
  imageRef: Ref<HTMLImageElement | undefined>;
  /** 截图工作流状态文案。 */
  imageStatus: Ref<string>;
  /** 当前图片 data URL。 */
  imageUrl: Ref<string>;
  /** 当前图片宽度。 */
  imageWidth: Ref<number>;
  /** 把边界点约束到图片画布内。 */
  normalizeBoundsPickerPoint: (point: PixelPoint) => PixelPoint;
  /** 舞台显示高度。 */
  stageDisplayHeight: Ref<number>;
  /** 舞台显示宽度。 */
  stageDisplayWidth: Ref<number>;
  /** 舞台 DOM 引用。 */
  stageRef: Ref<HTMLElement | undefined>;
}

/** 截图输入、图片尺寸和舞台坐标转换的页面侧 Module。 */
export function useGraphwarScreenshotWorkflow(
  options: GraphwarScreenshotWorkflowOptions,
): GraphwarScreenshotWorkflowController {
  const imageUrl = ref("");
  const imageName = ref("");
  const imageStatus = ref("");
  const imageWidth = ref(graphwarToolDefaults.canvasWidth);
  const imageHeight = ref(graphwarToolDefaults.canvasHeight);
  const imageRef = ref<HTMLImageElement>();
  const stageRef = ref<HTMLElement>();
  const stageDisplayWidth = ref(graphwarToolDefaults.canvasWidth);
  const stageDisplayHeight = ref(graphwarToolDefaults.canvasHeight);
  let imageInputGeneration = 0;

  /** 从隐藏文件输入框加载用户上传的截图。 */
  function handleImageUpload(event: Event) {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement) || !input.files?.[0]) {
      return;
    }

    loadImageFile(input.files[0]);
    input.value = "";
  }

  /** 处理页面上的 Ctrl / Cmd + V 直接粘贴图片。 */
  function handlePaste(event: ClipboardEvent) {
    const items = Array.from(event.clipboardData?.items ?? []);
    const imageItem = items.find((item) => item.type.startsWith("image/"));
    const file = imageItem?.getAsFile();
    if (!file) {
      return;
    }

    event.preventDefault();
    loadImageFile(file);
  }

  /** 处理拖拽截图到舞台区域的加载逻辑。 */
  function handleDrop(event: DragEvent) {
    const file = Array.from(event.dataTransfer?.files ?? []).find((item) => item.type.startsWith("image/"));
    if (file) {
      loadImageFile(file);
    }
  }

  /** 将图片文件读取为 data URL，并设置为当前截图。 */
  function loadImageFile(file: File) {
    const requestGeneration = ++imageInputGeneration;
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (requestGeneration !== imageInputGeneration || typeof reader.result !== "string") {
        return;
      }

      applyLoadedImage(reader.result, file.name || options.imageText.pastedName);
    });
    reader.readAsDataURL(file);
  }

  /** 应用调用方生成的图片 URL；尺寸已知时先落地，避免等待图片 load 才能渲染 overlay。 */
  function applyGeneratedImage(url: string, name: string, width: number, height: number) {
    imageInputGeneration += 1;
    imageWidth.value = width;
    imageHeight.value = height;
    applyLoadedImage(url, name);
  }

  /** 通过浏览器 Screen Capture API 截取屏幕图片。 */
  async function captureScreenImage() {
    const requestGeneration = ++imageInputGeneration;
    if (typeof navigator === "undefined" || typeof document === "undefined") {
      imageStatus.value = options.imageText.screenCaptureUnavailable;
      return;
    }

    const mediaDevices = navigator.mediaDevices as MediaDevices & {
      getDisplayMedia?: (constraints?: { audio?: boolean; video?: boolean }) => Promise<MediaStream>;
    };
    if (!mediaDevices?.getDisplayMedia) {
      imageStatus.value = options.imageText.screenCaptureUnsupported;
      return;
    }

    let stream: MediaStream | undefined;
    try {
      stream = await mediaDevices.getDisplayMedia({ video: true, audio: false });
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await waitForVideoMetadata(video);
      await video.play();
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });

      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || graphwarToolDefaults.canvasWidth;
      canvas.height = video.videoHeight || graphwarToolDefaults.canvasHeight;
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("Canvas unavailable");
      }

      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      if (requestGeneration === imageInputGeneration) {
        applyLoadedImage(canvas.toDataURL("image/png"), options.imageText.screenCaptureName);
      }
    } catch {
      if (requestGeneration === imageInputGeneration) {
        imageStatus.value = options.imageText.screenCaptureIncomplete;
      }
    } finally {
      for (const track of stream?.getTracks() ?? []) {
        track.stop();
      }
    }
  }

  /** 托管等外部状态接管截图时，让迟到的文件读取和截屏结果无法回写。 */
  function invalidatePendingUserImageRequests() {
    imageInputGeneration += 1;
  }

  /** 等待截屏视频流拿到尺寸，以便绘制到 canvas。 */
  function waitForVideoMetadata(video: HTMLVideoElement) {
    return new Promise<void>((resolve, reject) => {
      video.addEventListener("loadedmetadata", () => resolve(), { once: true });
      video.addEventListener("error", () => reject(new Error("Video metadata unavailable")), { once: true });
    });
  }

  /** 应用已加载截图；图片相关状态先落地，再把业务清理交给页面回调。 */
  function applyLoadedImage(url: string, name: string) {
    const imageUrlUnchanged = imageUrl.value === url;

    imageUrl.value = url;
    imageName.value = name;
    imageStatus.value = "";
    options.onImageApplied?.();

    const image = imageRef.value;
    if (imageUrlUnchanged && image?.complete && image.naturalWidth > 0) {
      handleImageLoad();
    }
  }

  /** 截图元素加载后更新图片尺寸；业务识别由页面回调决定。 */
  function handleImageLoad() {
    const image = imageRef.value;
    if (!image) {
      return;
    }

    imageWidth.value = image.naturalWidth || graphwarToolDefaults.canvasWidth;
    imageHeight.value = image.naturalHeight || graphwarToolDefaults.canvasHeight;
    options.onImageLoaded?.();
  }

  /** 从当前图片元素复制像素，供识别和颜色采样使用。 */
  function getImageDataFromCurrentImage() {
    const image = imageRef.value;
    return image ? getImageDataFromElement(image) : undefined;
  }

  /** 从图片元素复制像素到独立 canvas，避免后续逻辑直接依赖 DOM 图片状态。 */
  function getImageDataFromElement(image: HTMLImageElement) {
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (width <= 0 || height <= 0) {
      return undefined;
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      return undefined;
    }

    context.drawImage(image, 0, 0, width, height);
    return context.getImageData(0, 0, width, height);
  }

  /** 将浏览器指针事件转换为截图像素坐标。 */
  function getImagePointFromEvent(event: MouseEvent): PixelPoint | undefined {
    const stage = stageRef.value;
    if (!stage) {
      return undefined;
    }

    const rect = stage.getBoundingClientRect();
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    if (width <= 0 || height <= 0) {
      return undefined;
    }

    stageDisplayWidth.value = width;
    stageDisplayHeight.value = height;

    return clampPixelPointToCanvas(
      createPixelPoint(
        ((event.clientX - rect.left - stage.clientLeft) / width) * imageWidth.value,
        ((event.clientY - rect.top - stage.clientTop) / height) * imageHeight.value,
      ),
      imageWidth.value,
      imageHeight.value,
    );
  }

  /** 将边界框选点限制在当前截图画布内。 */
  function normalizeBoundsPickerPoint(point: PixelPoint) {
    return createPixelPoint(
      Math.round(clampNumber(point.x, 0, imageWidth.value)),
      Math.round(clampNumber(point.y, 0, imageHeight.value)),
    );
  }

  return {
    applyGeneratedImage,
    captureScreenImage,
    getImageDataFromCurrentImage,
    getImagePointFromEvent,
    handleDrop,
    handleImageLoad,
    handleImageUpload,
    handlePaste,
    imageHeight,
    imageName,
    imageRef,
    imageStatus,
    imageUrl,
    imageWidth,
    invalidatePendingUserImageRequests,
    normalizeBoundsPickerPoint,
    stageDisplayHeight,
    stageDisplayWidth,
    stageRef,
  };
}
