export type LabLang = 'python' | 'javascript'
export interface Template { id: string; title: string; code: Record<LabLang, string> }

export const TEMPLATES: Template[] = [
  { id: 'hello', title: 'Hello, World', code: {
    python: 'name = "Forked Learn"\nprint(f"Hello, {name}!")\n',
    javascript: 'const name = "Forked Learn"\nconsole.log(`Hello, ${name}!`)\n' } },
  { id: 'loop', title: 'Loops & conditions', code: {
    python: 'for n in range(1, 16):\n    if n % 15 == 0:\n        print("FizzBuzz")\n    elif n % 3 == 0:\n        print("Fizz")\n    elif n % 5 == 0:\n        print("Buzz")\n    else:\n        print(n)\n',
    javascript: 'for (let n = 1; n <= 15; n++) {\n  if (n % 15 === 0) console.log("FizzBuzz")\n  else if (n % 3 === 0) console.log("Fizz")\n  else if (n % 5 === 0) console.log("Buzz")\n  else console.log(n)\n}\n' } },
  { id: 'functions', title: 'Functions', code: {
    python: 'def fib(n):\n    a, b = 0, 1\n    for _ in range(n):\n        a, b = b, a + b\n    return a\n\nprint([fib(i) for i in range(10)])\n',
    javascript: 'function fib(n) {\n  let [a, b] = [0, 1]\n  for (let i = 0; i < n; i++) [a, b] = [b, a + b]\n  return a\n}\n\nconsole.log(Array.from({ length: 10 }, (_, i) => fib(i)))\n' } },
  { id: 'collections', title: 'Lists & objects', code: {
    python: 'items = [{"name": "map", "price": 5}, {"name": "sword", "price": 25}]\ncheap = [i["name"] for i in items if i["price"] < 10]\nprint(cheap)\nprint(sum(i["price"] for i in items))\n',
    javascript: 'const items = [{ name: "map", price: 5 }, { name: "sword", price: 25 }]\nconst cheap = items.filter((i) => i.price < 10).map((i) => i.name)\nconsole.log(cheap)\nconsole.log(items.reduce((s, i) => s + i.price, 0))\n' } },
  { id: 'input', title: 'Read input (stdin)', code: {
    python: '# Type values in the Input tab, one per line.\nname = input("Name? ")\nage = int(input("Age? "))\nprint(f"{name} will be {age + 1} next year")\n',
    javascript: '// Type values in the Input tab, one per line.\nconst name = input("Name? ")\nconst age = Number(input("Age? "))\nconsole.log(`${name} will be ${age + 1} next year`)\n' } },
  { id: 'classes', title: 'Classes', code: {
    python: 'class Hero:\n    def __init__(self, name, hp=100):\n        self.name, self.hp = name, hp\n\n    def hit(self, dmg):\n        self.hp = max(0, self.hp - dmg)\n        return self\n\nh = Hero("Denia").hit(30).hit(25)\nprint(h.name, h.hp)\n',
    javascript: 'class Hero {\n  constructor(name, hp = 100) { this.name = name; this.hp = hp }\n  hit(dmg) { this.hp = Math.max(0, this.hp - dmg); return this }\n}\n\nconst h = new Hero("Denia").hit(30).hit(25)\nconsole.log(h.name, h.hp)\n' } },
]
export const blank = (lang: LabLang) => TEMPLATES[0].code[lang]
