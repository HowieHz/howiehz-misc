import type { SoldierMatchCandidate, SoldierTemplateCenterCandidate } from "../graphwar-detection";
import type { BoundsRect } from "../types";

export interface GraphwarSoldierTemplateWorkerRequest {
  id: number;
  imageData: ImageData;
  edgeRect: BoundsRect;
  scale: number;
  candidates: readonly SoldierTemplateCenterCandidate[];
}

export type GraphwarSoldierTemplateWorkerResponse =
  | {
      id: number;
      elapsedMs: number;
      matches: SoldierMatchCandidate[];
      type: "success";
    }
  | {
      id: number;
      message: string;
      type: "error";
    };
