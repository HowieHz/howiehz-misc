/** 生成公式中可能出现 `z / abs(z)` 的逻辑位置；位值允许每个原始路径段用一个整数保存保护集合。 */
export enum GraphwarSignRole {
  StartX = 1,
  EndX = 2,
  CenterX = 4,
  GateY = 8,
  BrakingGateY = 16,
}

/** 每项按原始路径段索引保存角色位；省略项和尾部 0 都表示该段没有保护。 */
export type GraphwarSignProtection = readonly number[];

/** 判断某个逻辑 sign 项是否已确认需要分母 epsilon。 */
export function isGraphwarSignProtected(
  protection: GraphwarSignProtection | undefined,
  segmentIndex: number,
  role: GraphwarSignRole,
) {
  return Boolean((protection?.[segmentIndex] ?? 0) & role);
}

/** 比较保护快照；尾部 0 不改变公式，追加普通路径段时仍应允许复用旧前缀。 */
export function graphwarSignProtectionEquals(
  left: GraphwarSignProtection | undefined,
  right: GraphwarSignProtection | undefined,
) {
  const length = Math.max(left?.length ?? 0, right?.length ?? 0);
  for (let index = 0; index < length; index += 1) {
    if ((left?.[index] ?? 0) !== (right?.[index] ?? 0)) {
      return false;
    }
  }
  return true;
}
