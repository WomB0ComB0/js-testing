import { $ } from 'bun';

function selfExecute<T extends { new(...args: any[]): {} }>(constructor: T) {
  new constructor();
  return constructor;
}

@selfExecute
class Main {
  constructor() {
    if (require.main === module) {
      this.run();
    }
  }

  run() {
    
  }
}