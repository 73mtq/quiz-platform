export function shuffleArray(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

export function createOptionOrderCache() {
  const orders = new Map();

  return {
    ordered(question) {
      if (!Array.isArray(question?.options)) return [];
      const cached = orders.get(question.id);
      if (cached
        && cached.length === question.options.length
        && cached.every((option) => question.options.includes(option))) {
        return cached;
      }
      const shuffled = shuffleArray(question.options);
      orders.set(question.id, shuffled);
      return shuffled;
    },
    clear(questionId) {
      orders.delete(questionId);
    },
    clearAll() {
      orders.clear();
    }
  };
}
