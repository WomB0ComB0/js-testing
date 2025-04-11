{
  return new Promise((resolve) => {
    this.rl.question(question, resolve);
  });
}
