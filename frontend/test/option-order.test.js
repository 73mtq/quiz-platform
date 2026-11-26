import assert from "node:assert/strict";
import test from "node:test";
import { createOptionOrderCache, shuffleArray } from "../src/ui/optionOrder.js";

test("option order stays stable for the same question", () => {
  const cache = createOptionOrderCache();
  const question = {
    id: "q1",
    options: [
      { key: "A", text: "甲" },
      { key: "B", text: "乙" },
      { key: "C", text: "丙" },
      { key: "D", text: "丁" }
    ]
  };

  const first = cache.ordered(question);
  const second = cache.ordered(question);
  assert.equal(first, second);
  assert.deepEqual(first.map((option) => option.key).sort(), ["A", "B", "C", "D"]);
});

test("option cache invalidates when option references change", () => {
  const cache = createOptionOrderCache();
  const firstOptions = [{ key: "A", text: "甲" }, { key: "B", text: "乙" }];
  const question = { id: "q2", options: firstOptions };
  const first = cache.ordered(question);

  const nextOptions = [{ key: "A", text: "甲" }, { key: "B", text: "丙" }];
  question.options = nextOptions;
  const second = cache.ordered(question);

  assert.notEqual(first, second);
  assert.deepEqual(second.map((option) => option.text).sort(), ["丙", "甲"]);
});

test("clear removes a cached order", () => {
  const cache = createOptionOrderCache();
  const question = { id: "q3", options: [{ key: "A", text: "甲" }, { key: "B", text: "乙" }] };
  cache.ordered(question);
  cache.clear(question.id);
  assert.equal(cache.ordered(question).length, 2);
});

test("shuffleArray returns a new array", () => {
  const original = [1, 2, 3, 4];
  const result = shuffleArray(original);
  assert.notEqual(result, original);
  assert.deepEqual([...result].sort(), [...original].sort());
});
