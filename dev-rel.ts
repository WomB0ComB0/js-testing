/**
 * Copyright (c) 2025 Mike Odnis
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

export default (async () =>
	Array.from([
		"Adam DuVander",
		"Amit Jotwani",
		"Ashley Smith",
		"Bear Douglas",
		"Cecelia Martinez",
		"Craig Dennis",
		"Erin McKean",
		"Erin Mikail Staples",
		"Gene Chorba",
		"Hadley Harris",
		"Jason Baum",
		"Joel Lord",
		"John Britton",
		"Joyce Lin",
		"Katie Miller",
		"Kelley Robinson",
		"Kelsey Hightower",
		"Kevin Lewis",
		"Lauri Moore",
		"Maria Ashby",
		"Matt Makai",
		"Matthew Revell",
		"Matty Stratton",
		"Meghan Grady",
		"Meghan Murphy",
		"Mike Swift",
		"Mohammad Al-Ansari",
		"Moran Weber",
		"Naomi Pilosof Ionita",
		"Nick Gomez",
		"Nick Walsh",
		"Olivia Petrie",
		"Peter Moskovits",
		"Phil Leggetter",
		"Randall Degges",
		"Rebecca Marshburn",
		"Ron Northcutt",
		"Sarah Jane Morris",
		"Sean Falconer",
		"Shy Ruparel",
		"Steve Chen",
		"Tamao Nakahara",
		"Tena Sojer Keser",
		"Tiffany Jernigan",
		"Viktor Gamov",
		"Xe Iaso",
	]).map(async (v) =>
		setTimeout(
			async () =>
				(await import("node:child_process")).execSync(
					`xdg-open https://www.linkedin.com/search/results/all/?keywords=${encodeURI(v)}`,
				),
			10000,
		),
	))();

/**
 * Array.from(document.querySelector("body > hoverboard-app").shadowRoot.querySelector("#headerLayout > main > previous-speakers-page").shadowRoot.querySelectorAll("div > a > div > h2")).flatMap(t => t.innerHTML)
 *
 * @see https://nyc.devrelcon.dev/previous-speakers
 */
