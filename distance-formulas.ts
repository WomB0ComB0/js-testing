// @ts-nocheck
import { $, argv, } from 'bun';

function selfExecute<T extends { new(...args: any[]): {} }>(constructor: T): T {
  new constructor();
  return constructor;
}

@selfExecute
class Main {
  private readonly argv = argv.slice(2) as [string, ...number[]];

  constructor() {
    if (require.main === module) {
      this.run();
    }
  }

  run() {
    const [option="euclidean", ...coordinates] = this.argv;
    const lat1 = parseFloat(coordinates[0] || 0);
    const lng1 = parseFloat(coordinates[1] || 0);
    const lat2 = parseFloat(coordinates[2] || 0);
    const lng2 = parseFloat(coordinates[3] || 0);
    const lng3 = parseFloat(coordinates[4] || 0);
    const lat3 = parseFloat(coordinates[5] || 0);
    const p = parseFloat(coordinates[6] || 2);

    switch (option) {
      case 'euclidean':
        console.log(this.euclideanDistance(lat1, lng1, lat2, lng2));
        break;
      case 'haversine':
        console.log(this.haversineDistance(lat1, lng1, lat2, lng2));
        break;
      case 'vincenty':
        console.log(this.vincentyDistance(lat1, lng1, lat2, lng2));
        break;
      case 'manhattan':
        console.log(this.manhattanDistance(lat1, lng1, lat2, lng2));
        break;
      case 'chebyshev':
        console.log(this.chebyshevDistance(lat1, lng1, lat2, lng2));
        break;
      case 'minkowski':
        const p = parseFloat(coordinates[6] || 2);
        console.log(this.minkowskiDistance(lat1, lng1, lat2, lng2, p));
        break;
      case '3d':
        console.log(this.threedDistance(lat1, lng1, lat2, lng2, lat3, lng3));
        break;
      default:
        console.log(`Unknown distance formula: ${option}`);
        console.log('Available options: euclidean, haversine, vincenty, manhattan, chebyshev, minkowski, 3d');
        break;
    }
  }

  private euclideanDistance(lat1: number, lng1: number, lat2: number, lng2: number) {
    const dLat = lat2 - lat1;
    const dLng = lng2 - lng1;
    return Math.sqrt(dLat * dLat + dLng * dLng);
  }

  private haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number) {
    const R = 6371; // Earth's radius in kilometers
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLng = (lng2 - lng1) * (Math.PI / 180);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private vincentyDistance(lat1: number, lng1: number, lat2: number, lng2: number) {
    // Convert latitude and longitude from degrees to radians
    const toRad = (degree: number) => degree * Math.PI / 180;
    
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
    
    const sinU1 = Math.sin(U1), cosU1 = Math.cos(U1);
    const sinU2 = Math.sin(U2), cosU2 = Math.cos(U2);
    
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
      const sinLambda = Math.sin(lambda), cosLambda = Math.cos(lambda);
      sinSigma = Math.sqrt(
        Math.pow(cosU2 * sinLambda, 2) + 
        Math.pow(cosU1 * sinU2 - sinU1 * cosU2 * cosLambda, 2)
      );
      
      if (sinSigma === 0) return 0; // coincident points
      
      const cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
      sigma = Math.atan2(sinSigma, cosSigma);
      sinAlpha = cosU1 * cosU2 * sinLambda / sinSigma;
      cosSqAlpha = 1 - sinAlpha * sinAlpha;
      
      cos2SigmaM = cosSigma - 2 * sinU1 * sinU2 / cosSqAlpha;
      if (isNaN(cos2SigmaM)) cos2SigmaM = 0; // equatorial line
      
      const C = f / 16 * cosSqAlpha * (4 + f * (4 - 3 * cosSqAlpha));
      lambdaP = lambda;
      lambda = L + (1 - C) * f * sinAlpha * (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * Math.pow(cos2SigmaM, 2))));
      
      iter++;
    }
    
    if (iter >= iterLimit) return NaN; // formula failed to converge 



    const uSq = cosSqAlpha * (a * a - b * b) / (b * b);
    const A = 1 + uSq / 16384 * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
    const B = uSq / 1024 * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
    
    const deltaSigma = B * sinSigma * (cos2SigmaM + B / 4 * (cosSigma * (-1 + 2 * Math.pow(cos2SigmaM, 2)) - 
                      B / 6 * cos2SigmaM * (-3 + 4 * Math.pow(sinSigma, 2)) * (-3 + 4 * Math.pow(cos2SigmaM, 2))));
    
    const distance = b * A * (sigma - deltaSigma);
    
    return distance / 1000; // convert from meters to kilometers
  }

  private manhattanDistance(lat1: number, lng1: number, lat2: number, lng2: number) {
    return Math.abs(lat1 - lat2) + Math.abs(lng1 - lng2);
  }

  private chebyshevDistance(lat1: number, lng1: number, lat2: number, lng2: number) {
    return Math.max(Math.abs(lat1 - lat2), Math.abs(lng1 - lng2));
  }

  private minkowskiDistance(lat1: number, lng1: number, lat2: number, lng2: number, p: number = 2) {
    return Math.pow(Math.pow(Math.abs(lat1 - lat2), p) + Math.pow(Math.abs(lng1 - lng2), p), 1 / p);
  }

  private threedDistance(lat1: number, lng1: number, lat2: number, lng2: number, lat3: number, lng3: number) {
    return Math.sqrt(Math.pow(lat1 - lat2, 2) + Math.pow(lng1 - lng2, 2) + Math.pow(lat3 - lat2, 2) + Math.pow(lng3 - lng2, 2));
  }
}
