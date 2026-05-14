import type { RelationLevel } from "./core";

interface TestRelation {
  base: string;
  target: string;
  relation: RelationLevel;
  delta: number;
}

const testNamePool = [
  "灯塔",
  "雾港",
  "银轨",
  "星屑",
  "回声",
  "潮汐",
  "旧梦",
  "长夜",
  "纸月",
  "雪线",
  "风笛",
  "琥珀",
  "蓝井",
  "白塔",
  "夜航",
  "空庭",
] as const;

const rankedLevels = [
  ["better", 0.5],
  ["quite-better", 1],
  ["much-better", 2],
] as const satisfies readonly (readonly [RelationLevel, number])[];

export function createCompareRaterTestData() {
  const suffix = randomInt(10, 99);
  const names = shuffle(testNamePool)
    .slice(0, randomInt(7, 12))
    .map((name, index) => `${name}-${suffix + index}`);
  const relations = createRandomRelations(names);

  return {
    schema: "compare-rater-form",
    schemaVersion: 1,
    workType: "动画",
    field: pick(["无细分", "科幻", "奇幻", "日常", "剧情"]),
    aspect: pick(["综合", "剧情&叙事", "角色&演绎", "画面&美术"]),
    relations,
    weights: {
      same: 1,
      better: 0.5,
      quiteBetter: 1,
      muchBetter: 2,
    },
    anchors: {
      best: {
        name: relations[0]?.base ?? names[0],
        score: pick([9, 9.5, 10]),
      },
      worst: {
        name: relations.at(-1)?.target ?? names.at(-1),
        score: pick([1.5, 2, 2.5, 3]),
      },
    },
  };
}

function createRandomRelations(names: readonly string[]) {
  const relations: TestRelation[] = [];
  const pairKeys = new Set<string>();
  const chainCount = randomInt(4, Math.min(names.length - 1, 8));

  for (let index = 0; index < chainCount; index += 1) {
    addRelation(relations, pairKeys, names[index], names[index + 1], pick(rankedLevels));
  }

  const targetCount = randomInt(Math.max(8, names.length), Math.max(10, names.length + 4));
  while (relations.length < targetCount) {
    const baseIndex = randomInt(0, names.length - 1);
    const targetIndex = randomInt(0, names.length - 1);
    if (baseIndex === targetIndex) {
      continue;
    }

    const sameLayer = Math.random() < 0.22;
    const [base, target] =
      baseIndex < targetIndex ? [names[baseIndex], names[targetIndex]] : [names[targetIndex], names[baseIndex]];
    addRelation(relations, pairKeys, base, target, sameLayer ? ["same", 0] : pick(rankedLevels));
  }

  return relations;
}

function addRelation(
  relations: TestRelation[],
  pairKeys: Set<string>,
  base: string,
  target: string,
  [relation, delta]: readonly [RelationLevel, number],
) {
  const pairKey = [base, target].toSorted((left, right) => left.localeCompare(right, "zh-Hans-CN")).join("\u0000");
  if (pairKeys.has(pairKey)) {
    return;
  }

  pairKeys.add(pairKey);
  relations.push({ base, target, relation, delta });
}

function pick<T>(items: readonly T[]) {
  return items[randomInt(0, items.length - 1)] as T;
}

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle<T>(items: readonly T[]) {
  return [...items].sort(() => Math.random() - 0.5);
}
