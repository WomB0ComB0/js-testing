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

// @ts-nocheck
import { argv } from "bun";



class Main {
	private readonly argv = argv.slice(2) as [string, ...number[]];

	constructor() {
		if (import.meta.main) {
			this.run();
		}
	}

	run() {
		const [option = "euclidean", ...coordinates] = this.argv;
		const lat1 = Number.parseFloat(coordinates[0] || 0);
		const lng1 = Number.parseFloat(coordinates[1] || 0);
		const lat2 = Number.parseFloat(coordinates[2] || 0);
		const lng2 = Number.parseFloat(coordinates[3] || 0);
		const lng3 = Number.parseFloat(coordinates[4] || 0);
		const lat3 = Number.parseFloat(coordinates[5] || 0);


		switch (option) {
			case "euclidean":
				console.log(this.euclideanDistance(lat1, lng1, lat2, lng2));
				break;
			case "haversine":
				console.log(this.haversineDistance(lat1, lng1, lat2, lng2));
				break;
			case "vincenty":
				console.log(this.vincentyDistance(lat1, lng1, lat2, lng2));
				break;
			case "manhattan":
				console.log(this.manhattanDistance(lat1, lng1, lat2, lng2));
				break;
			case "chebyshev":
				console.log(this.chebyshevDistance(lat1, lng1, lat2, lng2));
				break;
			case "minkowski": {
				const p = Number.parseFloat(coordinates[6] || 2);
				console.log(this.minkowskiDistance(lat1, lng1, lat2, lng2, p));
				break;
			}
			case "3d":
				console.log(this.threedDistance(lat1, lng1, lat2, lng2, lat3, lng3));
				break;
			case "cosine":
				console.log(this.cosineDistance(lat1, lng1, lat2, lng2));
				break;
			case "hamming":
				console.log(this.hammingDistance(lat1, lng1, lat2, lng2));
				break;
			case "jaccard":
				console.log(this.jaccardDistance(lat1, lng1, lat2, lng2));
				break;
			case "sorensen-dice":
				console.log(this.sorensenDiceDistance(lat1, lng1, lat2, lng2));
				break;
			default:
				console.log(`Unknown distance formula: ${option}`);
				console.log(
					"Available options: euclidean, haversine, vincenty, manhattan, chebyshev, minkowski, 3d",
				);
				break;
		}
	}

	private euclideanDistance(
		lat1: number,
		lng1: number,
		lat2: number,
		lng2: number,
	) {
		const dLat = lat2 - lat1;
		const dLng = lng2 - lng1;
		return Math.hypot(dLat, dLng);
	}

	private haversineDistance(
		lat1: number,
		lng1: number,
		lat2: number,
		lng2: number,
	) {
		const R = 6371; // Earth's radius in kilometers
		const dLat = (lat2 - lat1) * (Math.PI / 180);
		const dLng = (lng2 - lng1) * (Math.PI / 180);
		const a =
			Math.sin(dLat / 2) * Math.sin(dLat / 2) +
			Math.cos(lat1 * (Math.PI / 180)) *
				Math.cos(lat2 * (Math.PI / 180)) *
				Math.sin(dLng / 2) *
				Math.sin(dLng / 2);
		const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
		return R * c;
	}

	private vincentyDistance(
		lat1: number,
		lng1: number,
		lat2: number,
		lng2: number,
	) {
		// Convert latitude and longitude from degrees to radians
		const toRad = (degree: number) => (degree * Math.PI) / 180;

		// WGS-84 ellipsoid parameters
		const a = 6378137; // semi-major axis in meters
		const b = 6356752.31424518; // semi-minor axis in meters
		const f = 1 / 298.257223563; // flattening

		const phi1 = toRad(lat1);
		const lambda1 = toRad(lng1);
		const phi2 = toRad(lat2);
		const lambda2 = toRad(lng2);

		const L = lambda2 - lambda1;

		const U1 = Math.atan((1 - f) * Math.tan(phi1));
		const U2 = Math.atan((1 - f) * Math.tan(phi2));

		const sinU1 = Math.sin(U1),
			cosU1 = Math.cos(U1);
		const sinU2 = Math.sin(U2),
			cosU2 = Math.cos(U2);

		let lambda: number = L;
		let lambdaP = 2 * Math.PI;
		const iterLimit = 20;
		let iter: number = 0;
		let cosSqAlpha: number,
			sinSigma: number,
			cos2SigmaM: number,
			sigma: number,
			sinAlpha: number;

		// Iterative formula
		while (Math.abs(lambda - lambdaP) > 1e-12 && iter < iterLimit) {
			const sinLambda = Math.sin(lambda),
				cosLambda = Math.cos(lambda);
			sinSigma = Math.hypot(
				cosU2 * sinLambda,
				cosU1 * sinU2 - sinU1 * cosU2 * cosLambda,
			);

			if (sinSigma === 0) return 0; // coincident points

			const cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
			sigma = Math.atan2(sinSigma, cosSigma);
			sinAlpha = (cosU1 * cosU2 * sinLambda) / sinSigma;
			cosSqAlpha = 1 - sinAlpha * sinAlpha;

			cos2SigmaM = cosSigma - (2 * sinU1 * sinU2) / cosSqAlpha;
			if (Number.isNaN(cos2SigmaM)) cos2SigmaM = 0; // equatorial line

			const C = (f / 16) * cosSqAlpha * (4 + f * (4 - 3 * cosSqAlpha));
			lambdaP = lambda;
			lambda =
				L +
				(1 - C) *
					f *
					sinAlpha *
					(sigma +
						C *
							sinSigma *
							(cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM ** 2)));

			iter++;
		}

		if (iter >= iterLimit) return Number.NaN; // formula failed to converge

		const uSq = (cosSqAlpha * (a * a - b * b)) / (b * b);
		const A =
			1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
		const B = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));

		const deltaSigma =
			B *
			sinSigma *
			(cos2SigmaM +
				(B / 4) *
					(cosSigma * (-1 + 2 * cos2SigmaM ** 2) -
						(B / 6) *
							cos2SigmaM *
							(-3 + 4 * sinSigma ** 2) *
							(-3 + 4 * cos2SigmaM ** 2)));

		const distance = b * A * (sigma - deltaSigma);

		return distance / 1000; // convert from meters to kilometers
	}

	private manhattanDistance(
		lat1: number,
		lng1: number,
		lat2: number,
		lng2: number,
	) {
		return Math.abs(lat1 - lat2) + Math.abs(lng1 - lng2);
	}

	private chebyshevDistance(
		lat1: number,
		lng1: number,
		lat2: number,
		lng2: number,
	) {
		return Math.max(Math.abs(lat1 - lat2), Math.abs(lng1 - lng2));
	}

	private minkowskiDistance(
		lat1: number,
		lng1: number,
		lat2: number,
		lng2: number,
		p: number = 2,
	) {
		return (Math.abs(lat1 - lat2) ** p + Math.abs(lng1 - lng2) ** p) ** (1 / p);
	}

	private threedDistance(
		lat1: number,
		lng1: number,
		lat2: number,
		lng2: number,
		lat3: number,
		lng3: number,
	) {
		return Math.hypot(
			lat1 - lat2,
			lng1 - lng2,
			lat3 - lat2,
			lng3 - lng2,
		);
	}

	private cosineDistance(
		lat1: number,
		lng1: number,
		lat2: number,
		lng2: number,
	) {
		const dotProduct = lat1 * lat2 + lng1 * lng2;
		const magnitude1 = Math.hypot(lat1, lng1);
		const magnitude2 = Math.hypot(lat2, lng2);
		return 1 - dotProduct / (magnitude1 * magnitude2);
	}

	private hammingDistance(
		n1: number,
		n2: number,
		n3: number,
		n4: number,
	) {
		// Treat inputs as binary strings if they look like binary (0s and 1s only)
		// Otherwise, treat as integers and compare bits?
		// Given the image shows binary vectors, let's assume the user might pass binary-like numbers.
		// But since we have 4 inputs (lat1, lng1, lat2, lng2), let's treat them as two vectors: [lat1, lng1] and [lat2, lng2].
		// If they are just 0s and 1s, we can compare them directly.
		
		const vec1 = [n1, n2];
		const vec2 = [n3, n4];
		let distance = 0;
		for (let i = 0; i < vec1.length; i++) {
			if (vec1[i] !== vec2[i]) {
				distance++;
			}
		}
		return distance;
	}

	private jaccardDistance(
		lat1: number,
		lng1: number,
		lat2: number,
		lng2: number,
	) {
		const setA = new Set([lat1, lng1]);
		const setB = new Set([lat2, lng2]);
		
		let intersection = 0;
		for (const item of setA) {
			if (setB.has(item)) {
				intersection++;
			}
		}
		
		const union = setA.size + setB.size - intersection;
		if (union === 0) return 0;
		return 1 - intersection / union;
	}

	private sorensenDiceDistance(
		lat1: number,
		lng1: number,
		lat2: number,
		lng2: number,
	) {
		const setA = new Set([lat1, lng1]);
		const setB = new Set([lat2, lng2]);
		
		let intersection = 0;
		for (const item of setA) {
			if (setB.has(item)) {
				intersection++;
			}
		}
		
		const denominator = setA.size + setB.size;
		if (denominator === 0) return 0;
		return 1 - (2 * intersection) / denominator;
	}
}

void new Main();
