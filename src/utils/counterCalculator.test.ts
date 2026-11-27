import {describe,it,expect} from "vitest";
import {calculatorReducer as reduce,initialCalculator,type CalcAction} from "./counterCalculator";
const run=(...actions:CalcAction[])=>actions.reduce(reduce,initialCalculator());
const d=(digit:string):CalcAction=>({type:"digit",digit});
const op=(op:"+"|"-"|"×"|"÷"):CalcAction=>({type:"operator",op});
const eq:CalcAction={type:"equals"};
describe("counter calculator",()=>{
 it("chains immediate operations without losing the preceding operand",()=>expect(run(d("2"),op("+"),d("3"),op("×"),d("4"),eq).display).toBe("20"));
 it("replaces a pending operator",()=>expect(run(d("8"),op("+"),op("÷"),d("2"),eq).display).toBe("4"));
 it("repeats equals and starts fresh when typing after result",()=>{const s=run(d("2"),op("+"),d("3"),eq,eq);expect(s.display).toBe("8");expect(reduce(s,d("7")).display).toBe("7");});
 it("does contextual discount and addition percentages",()=>{expect(run(d("2"),d("0"),d("0"),op("-"),d("1"),d("0"),{type:"percent"},eq).display).toBe("180");expect(run(d("2"),d("0"),d("0"),op("+"),d("1"),d("0"),{type:"percent"},eq).display).toBe("220");});
 it("retains useful fractional precision and handles zero division",()=>{expect(run(d("1"),op("÷"),d("3"),eq).display).toBe("0.333333333333");const s=run(d("1"),op("÷"),d("0"),eq);expect(s.display).toBe("Error");expect(reduce(s,d("5")).display).toBe("5");});
 it("distinguishes markup and gross margin and reverses GST",()=>{const s=run(d("1"),d("0"),d("0"));expect(reduce(s,{type:"retail",kind:"markup",rate:25}).display).toBe("125");expect(reduce(s,{type:"retail",kind:"margin",rate:20}).display).toBe("125");const g=reduce(s,{type:"retail",kind:"addGST",rate:18});expect(g.display).toBe("118");expect(reduce(g,{type:"retail",kind:"removeGST",rate:18}).display).toBe("100");expect(reduce(s,{type:"retail",kind:"margin",rate:100})).toEqual(s);});
 it("supports negative entry, decimals, history recall and clearing",()=>{const s=run({type:"sign"},d("2"),{type:"decimal"},d("5"),op("+"),d("1"),eq);expect(s.display).toBe("-1.5");expect(s.history.length).toBe(1);expect(reduce(s,{type:"recall",value:"-1.5"}).display).toBe("-1.5");expect(reduce(s,{type:"clearHistory"}).history).toEqual([]);});
});
