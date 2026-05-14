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

const extraRelationCountOptions = [4, 5, 6] as const;

export function createCompareRaterTestData() {
  const suffix = randomInt(10, 99);
  const names = shuffle(testNamePool)
    .slice(0, 10)
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

  // 固定主链保证图有明确层级，后面的补边负责制造不同交叉和同层情况。
  for (let index = 0; index < 6; index += 1) {
    addRelation(relations, pairKeys, names[index], names[index + 1], pick(rankedLevels));
  }

  for (const [baseIndex, targetIndex] of shuffle(getExtraRelationPairs()).slice(0, pick(extraRelationCountOptions))) {
    addRelation(
      relations,
      pairKeys,
      names[baseIndex],
      names[targetIndex],
      Math.abs(baseIndex - targetIndex) <= 2 && Math.random() < 0.35 ? ["same", 0] : pick(rankedLevels),
    );
  }

  return relations;
}

function getExtraRelationPairs() {
  return [
    [0, 3],
    [0, 5],
    [1, 4],
    [1, 8],
    [2, 7],
    [3, 5],
    [3, 9],
    [4, 8],
    [6, 9],
    [7, 9],
  ] as const;
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
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(0, index);
    [result[index], result[swapIndex]] = [result[swapIndex] as T, result[index] as T];
  }
  return result;
}
