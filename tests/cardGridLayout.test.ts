import assert from "node:assert/strict";
import test from "node:test";
import {
  getCardGridLayout,
  MIN_SQUARE_TWO_COLUMN_GRID_WIDTH
} from "../src/ui/cardGridLayout";

const recommendedSquareOptions = { squareTwoColumnMaxWidth: 480 };

test("portrait layouts keep the existing fixed heights and responsive columns", () => {
  assert.equal(getCardGridLayout("small", "portrait", 1000, 1).cardHeight, 300);
  assert.equal(getCardGridLayout("medium", "portrait", 1000, 1).cardHeight, 420);
  assert.equal(getCardGridLayout("large", "portrait", 1000, 1).cardHeight, 520);
  assert.equal(
    getCardGridLayout(
      "small",
      "portrait",
      390,
      5,
      recommendedSquareOptions
    ).columns,
    2
  );
  assert.equal(
    getCardGridLayout(
      "medium",
      "portrait",
      390,
      5,
      recommendedSquareOptions
    ).columns,
    1
  );
});

test("iPhone portrait widths keep square cards at exactly two columns", () => {
  for (const width of [320, 360, 375, 390, 430, 440, 480]) {
    for (const size of ["small", "medium", "large"] as const) {
      assert.equal(
        getCardGridLayout(
          size,
          "square",
          width,
          5,
          recommendedSquareOptions
        ).columns,
        2,
        `${size} at ${width}px`
      );
    }
  }
});

test("square cards use one column below the minimum safe two-column width", () => {
  const narrow = getCardGridLayout(
    "small",
    "square",
    MIN_SQUARE_TWO_COLUMN_GRID_WIDTH - 1,
    5,
    recommendedSquareOptions
  );
  const boundary = getCardGridLayout(
    "large",
    "square",
    MIN_SQUARE_TWO_COLUMN_GRID_WIDTH,
    5,
    recommendedSquareOptions
  );

  assert.equal(narrow.columns, 1);
  assert.equal(boundary.columns, 2);
});

test("wider square layouts adapt columns to Card size", () => {
  const expectedColumns = [
    { width: 680, small: 3, medium: 2, large: 2 },
    { width: 820, small: 4, medium: 3, large: 2 },
    { width: 1080, small: 5, medium: 4, large: 3 },
    { width: 1280, small: 6, medium: 5, large: 4 }
  ];

  for (const expected of expectedColumns) {
    for (const size of ["small", "medium", "large"] as const) {
      assert.equal(
        getCardGridLayout(
          size,
          "square",
          expected.width,
          20,
          recommendedSquareOptions
        ).columns,
        expected[size],
        `${size} at ${expected.width}px`
      );
    }
  }
});

test("the configurable breakpoint extends or shortens the exact two-column range", () => {
  assert.equal(
    getCardGridLayout("small", "square", 680, 5, {
      squareTwoColumnMaxWidth: 800
    }).columns,
    2
  );
  assert.equal(
    getCardGridLayout("small", "square", 801, 5, {
      squareTwoColumnMaxWidth: 800
    }).columns,
    4
  );
  assert.equal(
    getCardGridLayout("small", "square", 680, 5, {
      squareTwoColumnMaxWidth: 300
    }).columns,
    3
  );
});

test("square layout recalculates row height and total height after a width change", () => {
  const narrow = getCardGridLayout(
    "medium",
    "square",
    360,
    5,
    recommendedSquareOptions
  );
  const wide = getCardGridLayout(
    "medium",
    "square",
    820,
    5,
    recommendedSquareOptions
  );

  assert.equal(narrow.columns, 2);
  assert.equal(narrow.cardHeight, 174);
  assert.equal(narrow.rowCount, 3);
  assert.equal(narrow.totalHeight, 3 * (174 + 12) - 12);

  assert.equal(wide.columns, 3);
  assert.equal(wide.cardHeight, (820 - 24) / 3);
  assert.equal(wide.rowCount, 2);
  assert.equal(wide.totalHeight, 2 * (wide.cardHeight + 12) - 12);
});

test("layout is safe before measurement and for an empty page list", () => {
  const layout = getCardGridLayout(
    "medium",
    "square",
    0,
    0,
    recommendedSquareOptions
  );

  assert.equal(layout.columns, 1);
  assert.equal(layout.columnWidth, 230);
  assert.equal(layout.cardHeight, 230);
  assert.equal(layout.rowCount, 0);
  assert.equal(layout.totalHeight, 0);
});
