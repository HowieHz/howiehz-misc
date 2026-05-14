export const compareRaterTestData = {
  schema: "compare-rater-form",
  schemaVersion: 1,
  workType: "动画",
  field: "科幻",
  aspect: "剧情&叙事",
  relations: [
    {
      base: "1",
      target: "2",
      relation: "better",
      delta: 0.5,
    },
    {
      base: "2",
      target: "3",
      relation: "much-better",
      delta: 2,
    },
    {
      base: "3",
      target: "4",
      relation: "better",
      delta: 0.5,
    },
    {
      base: "5",
      target: "6",
      relation: "better",
      delta: 0.5,
    },
    {
      base: "6",
      target: "7",
      relation: "better",
      delta: 0.5,
    },
    {
      base: "1",
      target: "4",
      relation: "much-better",
      delta: 2,
    },
    {
      base: "1",
      target: "6",
      relation: "much-better",
      delta: 2,
    },
    {
      base: "1",
      target: "11",
      relation: "better",
      delta: 0.5,
    },
    {
      base: "3",
      target: "5",
      relation: "same",
      delta: 0,
    },
    {
      base: "2",
      target: "30",
      relation: "better",
      delta: 0.5,
    },
  ],
  weights: {
    same: 1,
    better: 0.5,
    quiteBetter: 1,
    muchBetter: 2,
  },
  anchors: {
    best: {
      name: "1",
      score: 9.5,
    },
    worst: {
      name: "7",
      score: 3,
    },
  },
} as const;
