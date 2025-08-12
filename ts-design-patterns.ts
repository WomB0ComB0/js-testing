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

// ===== CREATIONAL PATTERNS =====

// 1. SINGLETON PATTERN
class DatabaseConnection {
  private static instance: DatabaseConnection;
  private connectionString: string;

  private constructor() {
    this.connectionString = "database://localhost:5432";
  }

  public static getInstance(): DatabaseConnection {
    if (!DatabaseConnection.instance) {
      DatabaseConnection.instance = new DatabaseConnection();
    }
    return DatabaseConnection.instance;
  }

  public query(sql: string): string {
    return `Executing: ${sql} on ${this.connectionString}`;
  }
}

// Usage
const db1 = DatabaseConnection.getInstance();
const db2 = DatabaseConnection.getInstance();
console.log(db1 === db2); // true - same instance

// 2. FACTORY METHOD PATTERN
interface Shape {
  draw(): string;
}

class Circle implements Shape {
  draw(): string {
    return "Drawing a Circle";
  }
}

class Rectangle implements Shape {
  draw(): string {
    return "Drawing a Rectangle";
  }
}

class Triangle implements Shape {
  draw(): string {
    return "Drawing a Triangle";
  }
}

abstract class ShapeFactory {
  abstract createShape(): Shape;
}

class CircleFactory extends ShapeFactory {
  createShape(): Shape {
    return new Circle();
  }
}

class RectangleFactory extends ShapeFactory {
  createShape(): Shape {
    return new Rectangle();
  }
}

// Usage
const circleFactory = new CircleFactory();
const circle = circleFactory.createShape();
console.log(circle.draw()); // "Drawing a Circle"

// 3. ABSTRACT FACTORY PATTERN
interface Button {
  render(): string;
}

interface TextBox {
  render(): string;
}

// Windows implementations
class WindowsButton implements Button {
  render(): string {
    return "Rendering Windows Button";
  }
}

class WindowsTextBox implements TextBox {
  render(): string {
    return "Rendering Windows TextBox";
  }
}

// MacOS implementations
class MacButton implements Button {
  render(): string {
    return "Rendering Mac Button";
  }
}

class MacTextBox implements TextBox {
  render(): string {
    return "Rendering Mac TextBox";
  }
}

// Abstract Factory
interface UIFactory {
  createButton(): Button;
  createTextBox(): TextBox;
}

class WindowsUIFactory implements UIFactory {
  createButton(): Button {
    return new WindowsButton();
  }
  
  createTextBox(): TextBox {
    return new WindowsTextBox();
  }
}

class MacUIFactory implements UIFactory {
  createButton(): Button {
    return new MacButton();
  }
  
  createTextBox(): TextBox {
    return new MacTextBox();
  }
}

// Usage
function createUI(factory: UIFactory) {
  const button = factory.createButton();
  const textBox = factory.createTextBox();
  return {
    button: button.render(),
    textBox: textBox.render()
  };
}

const windowsUI = createUI(new WindowsUIFactory());
const macUI = createUI(new MacUIFactory());

// 4. BUILDER PATTERN
class Computer {
  public cpu: string = "";
  public ram: string = "";
  public storage: string = "";
  public gpu: string = "";

  public toString(): string {
    return `Computer: CPU=${this.cpu}, RAM=${this.ram}, Storage=${this.storage}, GPU=${this.gpu}`;
  }
}

class ComputerBuilder {
  private computer: Computer;

  constructor() {
    this.computer = new Computer();
  }

  public setCPU(cpu: string): ComputerBuilder {
    this.computer.cpu = cpu;
    return this;
  }

  public setRAM(ram: string): ComputerBuilder {
    this.computer.ram = ram;
    return this;
  }

  public setStorage(storage: string): ComputerBuilder {
    this.computer.storage = storage;
    return this;
  }

  public setGPU(gpu: string): ComputerBuilder {
    this.computer.gpu = gpu;
    return this;
  }

  public build(): Computer {
    return this.computer;
  }
}

// Usage
const gamingPC = new ComputerBuilder()
  .setCPU("Intel i9")
  .setRAM("32GB")
  .setStorage("1TB SSD")
  .setGPU("RTX 4080")
  .build();

console.log(gamingPC.toString());

// 5. OBJECT POOL PATTERN
class DatabaseConnectionPool {
  private static instance: DatabaseConnectionPool;
  private pool: Connection[] = [];
  private usedConnections: Connection[] = [];
  private readonly maxPoolSize = 5;

  private constructor() {
    // Initialize pool with connections
    for (let i = 0; i < this.maxPoolSize; i++) {
      this.pool.push(new Connection(`conn_${i}`));
    }
  }

  public static getInstance(): DatabaseConnectionPool {
    if (!DatabaseConnectionPool.instance) {
      DatabaseConnectionPool.instance = new DatabaseConnectionPool();
    }
    return DatabaseConnectionPool.instance;
  }

  public getConnection(): Connection | null {
    if (this.pool.length === 0) {
      return null; // No connections available
    }
    
    const connection = this.pool.pop()!;
    this.usedConnections.push(connection);
    return connection;
  }

  public releaseConnection(connection: Connection): void {
    const index = this.usedConnections.indexOf(connection);
    if (index !== -1) {
      this.usedConnections.splice(index, 1);
      this.pool.push(connection);
    }
  }

  public getPoolStatus(): string {
    return `Available: ${this.pool.length}, Used: ${this.usedConnections.length}`;
  }
}

class Connection {
  constructor(public id: string) {}
  
  public execute(query: string): string {
    return `Connection ${this.id} executing: ${query}`;
  }
}

// 6. PROTOTYPE PATTERN
interface Cloneable {
  clone(): Cloneable;
}

class Document implements Cloneable {
  public title: string;
  public content: string;
  public metadata: { [key: string]: any };

  constructor(title: string, content: string, metadata: { [key: string]: any } = {}) {
    this.title = title;
    this.content = content;
    this.metadata = { ...metadata };
  }

  public clone(): Document {
    return new Document(this.title, this.content, { ...this.metadata });
  }

  public toString(): string {
    return `Document: ${this.title} - ${this.content.substring(0, 50)}...`;
  }
}

// Usage
const originalDoc = new Document("Template", "This is a template document", { author: "John" });
const clonedDoc = originalDoc.clone();
clonedDoc.title = "New Document";
clonedDoc.content = "This is a new document based on template";

// ===== STRUCTURAL PATTERNS =====

// 7. ADAPTER PATTERN
// Legacy printer interface
class LegacyPrinter {
  public printOldWay(text: string): string {
    return `Legacy printer: ${text}`;
  }
}

// Modern printer interface
interface ModernPrinter {
  print(document: string): string;
}

// Adapter to make legacy printer work with modern interface
class PrinterAdapter implements ModernPrinter {
  private legacyPrinter: LegacyPrinter;

  constructor(legacyPrinter: LegacyPrinter) {
    this.legacyPrinter = legacyPrinter;
  }

  public print(document: string): string {
    return this.legacyPrinter.printOldWay(document);
  }
}

// Usage
const legacyPrinter = new LegacyPrinter();
const adapter = new PrinterAdapter(legacyPrinter);
console.log(adapter.print("Hello World")); // "Legacy printer: Hello World"

// 8. BRIDGE PATTERN
// Implementation interface
interface DrawingAPI {
  drawCircle(x: number, y: number, radius: number): string;
  drawRectangle(x: number, y: number, width: number, height: number): string;
}

// Concrete implementations
class WindowsDrawingAPI implements DrawingAPI {
  drawCircle(x: number, y: number, radius: number): string {
    return `Windows: Drawing circle at (${x}, ${y}) with radius ${radius}`;
  }

  drawRectangle(x: number, y: number, width: number, height: number): string {
    return `Windows: Drawing rectangle at (${x}, ${y}) with size ${width}x${height}`;
  }
}

class MacDrawingAPI implements DrawingAPI {
  drawCircle(x: number, y: number, radius: number): string {
    return `Mac: Drawing circle at (${x}, ${y}) with radius ${radius}`;
  }

  drawRectangle(x: number, y: number, width: number, height: number): string {
    return `Mac: Drawing rectangle at (${x}, ${y}) with size ${width}x${height}`;
  }
}

// Abstraction
abstract class Shape2D {
  protected drawingAPI: DrawingAPI;

  constructor(drawingAPI: DrawingAPI) {
    this.drawingAPI = drawingAPI;
  }

  abstract draw(): string;
}

// Refined abstractions
class CircleShape extends Shape2D {
  private x: number;
  private y: number;
  private radius: number;

  constructor(x: number, y: number, radius: number, drawingAPI: DrawingAPI) {
    super(drawingAPI);
    this.x = x;
    this.y = y;
    this.radius = radius;
  }

  draw(): string {
    return this.drawingAPI.drawCircle(this.x, this.y, this.radius);
  }
}

class RectangleShape extends Shape2D {
  private x: number;
  private y: number;
  private width: number;
  private height: number;

  constructor(x: number, y: number, width: number, height: number, drawingAPI: DrawingAPI) {
    super(drawingAPI);
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
  }

  draw(): string {
    return this.drawingAPI.drawRectangle(this.x, this.y, this.width, this.height);
  }
}

// Usage
const windowsCircle = new CircleShape(10, 10, 5, new WindowsDrawingAPI());
const macRectangle = new RectangleShape(0, 0, 100, 50, new MacDrawingAPI());

// 9. COMPOSITE PATTERN
interface FileSystemComponent {
  getName(): string;
  getSize(): number;
  display(indent?: string): string;
}

class File implements FileSystemComponent {
  private name: string;
  private size: number;

  constructor(name: string, size: number) {
    this.name = name;
    this.size = size;
  }

  getName(): string {
    return this.name;
  }

  getSize(): number {
    return this.size;
  }

  display(indent: string = ""): string {
    return `${indent}📄 ${this.name} (${this.size} bytes)`;
  }
}

class Directory implements FileSystemComponent {
  private name: string;
  private children: FileSystemComponent[] = [];

  constructor(name: string) {
    this.name = name;
  }

  getName(): string {
    return this.name;
  }

  getSize(): number {
    return this.children.reduce((total, child) => total + child.getSize(), 0);
  }

  add(component: FileSystemComponent): void {
    this.children.push(component);
  }

  remove(component: FileSystemComponent): void {
    const index = this.children.indexOf(component);
    if (index !== -1) {
      this.children.splice(index, 1);
    }
  }

  display(indent: string = ""): string {
    let result = `${indent}📁 ${this.name}/ (${this.getSize()} bytes total)\n`;
    for (const child of this.children) {
      result += child.display(indent + "  ") + "\n";
    }
    return result.trim();
  }
}

// Usage
const rootDir = new Directory("root");
const docsDir = new Directory("documents");
const imagesDir = new Directory("images");

docsDir.add(new File("resume.pdf", 1024));
docsDir.add(new File("letter.docx", 512));
imagesDir.add(new File("photo1.jpg", 2048));
imagesDir.add(new File("photo2.jpg", 1536));

rootDir.add(docsDir);
rootDir.add(imagesDir);
rootDir.add(new File("readme.txt", 256));

// 10. DECORATOR PATTERN
interface Coffee {
  cost(): number;
  description(): string;
}

class BasicCoffee implements Coffee {
  cost(): number {
    return 2.00;
  }

  description(): string {
    return "Basic Coffee";
  }
}

abstract class CoffeeDecorator implements Coffee {
  protected coffee: Coffee;

  constructor(coffee: Coffee) {
    this.coffee = coffee;
  }

  cost(): number {
    return this.coffee.cost();
  }

  description(): string {
    return this.coffee.description();
  }
}

class MilkDecorator extends CoffeeDecorator {
  cost(): number {
    return this.coffee.cost() + 0.50;
  }

  description(): string {
    return this.coffee.description() + ", Milk";
  }
}

class SugarDecorator extends CoffeeDecorator {
  cost(): number {
    return this.coffee.cost() + 0.25;
  }

  description(): string {
    return this.coffee.description() + ", Sugar";
  }
}

class WhipDecorator extends CoffeeDecorator {
  cost(): number {
    return this.coffee.cost() + 0.75;
  }

  description(): string {
    return this.coffee.description() + ", Whip";
  }
}

// Usage
let coffee: Coffee = new BasicCoffee();
coffee = new MilkDecorator(coffee);
coffee = new SugarDecorator(coffee);
coffee = new WhipDecorator(coffee);

console.log(`${coffee.description()} - $${coffee.cost()}`);
// "Basic Coffee, Milk, Sugar, Whip - $3.5"

// 11. FACADE PATTERN
// Complex subsystem classes
class CPU {
  freeze(): string { return "CPU frozen"; }
  jump(position: number): string { return `CPU jumped to ${position}`; }
  execute(): string { return "CPU executing"; }
}

class Memory {
  load(position: number, data: string): string {
    return `Memory loaded ${data} at ${position}`;
  }
}

class HardDrive {
  read(lba: number, size: number): string {
    return `HardDrive read ${size} bytes from ${lba}`;
  }
}

// Facade
class ComputerFacade {
  private cpu: CPU;
  private memory: Memory;
  private hardDrive: HardDrive;

  constructor() {
    this.cpu = new CPU();
    this.memory = new Memory();
    this.hardDrive = new HardDrive();
  }

  start(): string[] {
    const steps = [];
    steps.push(this.cpu.freeze());
    steps.push(this.memory.load(0, this.hardDrive.read(100, 1024)));
    steps.push(this.cpu.jump(0));
    steps.push(this.cpu.execute());
    return steps;
  }
}

// Usage
const computer = new ComputerFacade();
const bootSteps = computer.start();

// 12. FLYWEIGHT PATTERN
// Flyweight interface
interface TreeType {
  render(canvas: string, x: number, y: number): string;
}

// Concrete flyweight
class TreeTypeFlyweight implements TreeType {
  private name: string;
  private color: string;
  private sprite: string;

  constructor(name: string, color: string, sprite: string) {
    this.name = name;
    this.color = color;
    this.sprite = sprite;
  }

  render(canvas: string, x: number, y: number): string {
    return `Rendering ${this.name} tree (${this.color}) at (${x}, ${y}) on ${canvas}`;
  }
}

// Flyweight factory
class TreeTypeFactory {
  private static treeTypes: Map<string, TreeType> = new Map();

  static getTreeType(name: string, color: string, sprite: string): TreeType {
    const key = `${name}-${color}-${sprite}`;
    
    if (!this.treeTypes.has(key)) {
      this.treeTypes.set(key, new TreeTypeFlyweight(name, color, sprite));
    }
    
    return this.treeTypes.get(key)!;
  }

  static getCreatedTreeTypesCount(): number {
    return this.treeTypes.size;
  }
}

// Context
class Tree {
  private x: number;
  private y: number;
  private type: TreeType;

  constructor(x: number, y: number, type: TreeType) {
    this.x = x;
    this.y = y;
    this.type = type;
  }

  render(canvas: string): string {
    return this.type.render(canvas, this.x, this.y);
  }
}

// Forest (client)
class Forest {
  private trees: Tree[] = [];

  plantTree(x: number, y: number, name: string, color: string, sprite: string): void {
    const type = TreeTypeFactory.getTreeType(name, color, sprite);
    const tree = new Tree(x, y, type);
    this.trees.push(tree);
  }

  render(canvas: string): string[] {
    return this.trees.map(tree => tree.render(canvas));
  }

  getTreeCount(): number {
    return this.trees.length;
  }
}

// Usage
const forest = new Forest();
forest.plantTree(10, 20, "Oak", "Green", "oak_sprite");
forest.plantTree(30, 40, "Oak", "Green", "oak_sprite"); // Reuses flyweight
forest.plantTree(50, 60, "Pine", "Dark Green", "pine_sprite");

console.log(`Trees planted: ${forest.getTreeCount()}`); // 3
console.log(`TreeType flyweights created: ${TreeTypeFactory.getCreatedTreeTypesCount()}`); // 2

// 13. PROXY PATTERN
interface Image {
  display(): string;
}

// Real subject
class RealImage implements Image {
  private filename: string;

  constructor(filename: string) {
    this.filename = filename;
    this.loadImageFromDisk();
  }

  private loadImageFromDisk(): void {
    console.log(`Loading image: ${this.filename}`);
  }

  display(): string {
    return `Displaying image: ${this.filename}`;
  }
}

// Proxy
class ProxyImage implements Image {
  private realImage: RealImage | null = null;
  private filename: string;

  constructor(filename: string) {
    this.filename = filename;
  }

  display(): string {
    if (this.realImage === null) {
      this.realImage = new RealImage(this.filename);
    }
    return this.realImage.display();
  }
}

// Usage
const image1 = new ProxyImage("test1.jpg");
const image2 = new ProxyImage("test2.jpg");

// Image loading happens only when display() is called
console.log(image1.display()); // Loads and displays
console.log(image1.display()); // Just displays (already loaded)

// ===== BEHAVIORAL PATTERNS =====

// 14. OBSERVER PATTERN
interface Observer {
  update(message: string): void;
}

interface Subject {
  attach(observer: Observer): void;
  detach(observer: Observer): void;
  notify(message: string): void;
}

class NewsAgency implements Subject {
  private observers: Observer[] = [];
  private news: string = "";

  attach(observer: Observer): void {
    this.observers.push(observer);
  }

  detach(observer: Observer): void {
    const index = this.observers.indexOf(observer);
    if (index !== -1) {
      this.observers.splice(index, 1);
    }
  }

  notify(message: string): void {
    for (const observer of this.observers) {
      observer.update(message);
    }
  }

  setNews(news: string): void {
    this.news = news;
    this.notify(news);
  }

  getNews(): string {
    return this.news;
  }
}

class NewsChannel implements Observer {
  private name: string;

  constructor(name: string) {
    this.name = name;
  }

  update(message: string): void {
    console.log(`${this.name} received news: ${message}`);
  }
}

// Usage
const agency = new NewsAgency();
const cnn = new NewsChannel("CNN");
const bbc = new NewsChannel("BBC");

agency.attach(cnn);
agency.attach(bbc);
agency.setNews("Breaking: Design patterns are awesome!");

// 15. STRATEGY PATTERN
interface PaymentStrategy {
  pay(amount: number): string;
}

class CreditCardPayment implements PaymentStrategy {
  private cardNumber: string;

  constructor(cardNumber: string) {
    this.cardNumber = cardNumber;
  }

  pay(amount: number): string {
    return `Paid $${amount} using Credit Card ending in ${this.cardNumber.slice(-4)}`;
  }
}

class PayPalPayment implements PaymentStrategy {
  private email: string;

  constructor(email: string) {
    this.email = email;
  }

  pay(amount: number): string {
    return `Paid $${amount} using PayPal account ${this.email}`;
  }
}

class BitcoinPayment implements PaymentStrategy {
  private walletAddress: string;

  constructor(walletAddress: string) {
    this.walletAddress = walletAddress;
  }

  pay(amount: number): string {
    return `Paid $${amount} using Bitcoin wallet ${this.walletAddress.slice(0, 8)}...`;
  }
}

class PaymentContext {
  private strategy: PaymentStrategy;

  constructor(strategy: PaymentStrategy) {
    this.strategy = strategy;
  }

  setStrategy(strategy: PaymentStrategy): void {
    this.strategy = strategy;
  }

  executePayment(amount: number): string {
    return this.strategy.pay(amount);
  }
}

// Usage
const paymentContext = new PaymentContext(new CreditCardPayment("1234567890123456"));
console.log(paymentContext.executePayment(100));

paymentContext.setStrategy(new PayPalPayment("user@example.com"));
console.log(paymentContext.executePayment(50));

// 16. COMMAND PATTERN
interface Command {
  execute(): string;
  undo(): string;
}

// Receiver
class Light {
  private isOn: boolean = false;

  turnOn(): string {
    this.isOn = true;
    return "Light is ON";
  }

  turnOff(): string {
    this.isOn = false;
    return "Light is OFF";
  }

  getStatus(): boolean {
    return this.isOn;
  }
}

// Concrete Commands
class LightOnCommand implements Command {
  private light: Light;

  constructor(light: Light) {
    this.light = light;
  }

  execute(): string {
    return this.light.turnOn();
  }

  undo(): string {
    return this.light.turnOff();
  }
}

class LightOffCommand implements Command {
  private light: Light;

  constructor(light: Light) {
    this.light = light;
  }

  execute(): string {
    return this.light.turnOff();
  }

  undo(): string {
    return this.light.turnOn();
  }
}

// Invoker
class RemoteControl {
  private command: Command | null = null;
  private lastCommand: Command | null = null;

  setCommand(command: Command): void {
    this.command = command;
  }

  pressButton(): string {
    if (this.command) {
      this.lastCommand = this.command;
      return this.command.execute();
    }
    return "No command set";
  }

  pressUndo(): string {
    if (this.lastCommand) {
      return this.lastCommand.undo();
    }
    return "No command to undo";
  }
}

// Usage
const light = new Light();
const lightOnCommand = new LightOnCommand(light);
const lightOffCommand = new LightOffCommand(light);
const remote = new RemoteControl();

remote.setCommand(lightOnCommand);
console.log(remote.pressButton()); // "Light is ON"
console.log(remote.pressUndo());   // "Light is OFF"

// 17. STATE PATTERN
interface VendingMachineState {
  insertCoin(machine: VendingMachine): string;
  selectProduct(machine: VendingMachine): string;
  dispenseProduct(machine: VendingMachine): string;
}

class VendingMachine {
  private state: VendingMachineState;
  private idleState: VendingMachineState;
  private hasMoneyState: VendingMachineState;
  private soldState: VendingMachineState;

  constructor() {
    this.idleState = new IdleState();
    this.hasMoneyState = new HasMoneyState();
    this.soldState = new SoldState();
    this.state = this.idleState;
  }

  setState(state: VendingMachineState): void {
    this.state = state;
  }

  getIdleState(): VendingMachineState { return this.idleState; }
  getHasMoneyState(): VendingMachineState { return this.hasMoneyState; }
  getSoldState(): VendingMachineState { return this.soldState; }

  insertCoin(): string {
    return this.state.insertCoin(this);
  }

  selectProduct(): string {
    return this.state.selectProduct(this);
  }

  dispenseProduct(): string {
    return this.state.dispenseProduct(this);
  }
}

class IdleState implements VendingMachineState {
  insertCoin(machine: VendingMachine): string {
    machine.setState(machine.getHasMoneyState());
    return "Coin inserted. Please select a product.";
  }

  selectProduct(machine: VendingMachine): string {
    return "Please insert a coin first.";
  }

  dispenseProduct(machine: VendingMachine): string {
    return "Please insert a coin and select a product first.";
  }
}

class HasMoneyState implements VendingMachineState {
  insertCoin(machine: VendingMachine): string {
    return "Coin already inserted.";
  }

  selectProduct(machine: VendingMachine): string {
    machine.setState(machine.getSoldState());
    return "Product selected. Dispensing...";
  }

  dispenseProduct(machine: VendingMachine): string {
    return "Please select a product first.";
  }
}

class SoldState implements VendingMachineState {
  insertCoin(machine: VendingMachine): string {
    return "Please wait, dispensing product.";
  }

  selectProduct(machine: VendingMachine): string {
    return "Please wait, dispensing product.";
  }

  dispenseProduct(machine: VendingMachine): string {
    machine.setState(machine.getIdleState());
    return "Product dispensed. Thank you!";
  }
}

// Usage
const vendingMachine = new VendingMachine();
console.log(vendingMachine.insertCoin());      // "Coin inserted. Please select a product."
console.log(vendingMachine.selectProduct());   // "Product selected. Dispensing..."
console.log(vendingMachine.dispenseProduct()); // "Product dispensed. Thank you!"

// 18. TEMPLATE METHOD PATTERN
abstract class DataProcessor {
  // Template method
  public processData(): string[] {
    const results = [];
    results.push(this.readData());
    results.push(this.processRawData());
    results.push(this.saveData());
    return results;
  }

  protected abstract readData(): string;
  protected abstract processRawData(): string;
  protected abstract saveData(): string;
}

class CSVDataProcessor extends DataProcessor {
  protected readData(): string {
    return "Reading data from CSV file";
  }

  protected processRawData(): string {
    return "Processing CSV data: parsing columns, validating format";
  }

  protected saveData(): string {
    return "Saving processed CSV data to database";
  }
}

class XMLDataProcessor extends DataProcessor {
  protected readData(): string {
    return "Reading data from XML file";
  }

  protected processRawData(): string {
    return "Processing XML data: parsing tags, validating schema";
  }

  protected saveData(): string {
    return "Saving processed XML data to database";
  }
}

// Usage
const csvProcessor = new CSVDataProcessor();
const xmlProcessor = new XMLDataProcessor();

console.log("CSV Processing:");
csvProcessor.processData().forEach(step => console.log(step));

console.log("\nXML Processing:");
xmlProcessor.processData().forEach(step => console.log(step));

console.log("\n=== Design Patterns Examples Complete ===");
console.log("All major design patterns have been implemented in TypeScript!");