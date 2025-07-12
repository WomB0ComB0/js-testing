const selfExecute = <T extends { new(...args: any[]): {} }>( constructor: T): T  =>  (new constructor(), constructor)

@selfExecute
class Main {
  constructor() {
    console.log('Hello World!')
    console.log(`This is: ${this.constructor.name}\n`)
  }
}

console.log(`${(new Main()).constructor.name}`)