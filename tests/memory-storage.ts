export function memoryStorage():Storage {
  const data=new Map<string,string>();
  return {getItem:k=>data.get(k)??null,setItem:(k,v)=>{data.set(k,v);},removeItem:k=>{data.delete(k);},clear:()=>data.clear(),key:i=>Array.from(data.keys())[i]??null,get length(){return data.size;}};
}
