(async () => {
  const [a, b] = Array.from({ length: 2 }).fill([1, 2, 3, 4, 5, [6, 7, 8, 9, 10], [[11, 12, 13, 14, 15]]].flat(Infinity).map(x => Math.pow(x, 3)))
  console.log({a, b})
})()
