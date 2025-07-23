/**
 * Copyright 2025 Mike Odnis
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

export default (async () =>  Array.from([
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
    "Xe Iaso"
]).map(async (v) => setTimeout(async() => ((await import('node:child_process')).execSync(`xdg-open https://www.linkedin.com/search/results/all/?keywords=${encodeURI(v)}`)), 10000)))()

/**
 * Array.from(document.querySelector("body > hoverboard-app").shadowRoot.querySelector("#headerLayout > main > previous-speakers-page").shadowRoot.querySelectorAll("div > a > div > h2")).flatMap(t => t.innerHTML)
 * 
 * @see https://nyc.devrelcon.dev/previous-speakers
*/