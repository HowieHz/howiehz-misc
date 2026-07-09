/**
 * 读取当前监听器绑定的 input 值，供展示面板把 DOM input 事件适配成字符串 emit。
 *
 * 使用 currentTarget 而不是 target，避免事件冒泡来源变化时读到子节点或其他元素。
 */
export function getInputValue(event: Event) {
  const input = event.currentTarget;
  return input instanceof HTMLInputElement ? input.value : undefined;
}
