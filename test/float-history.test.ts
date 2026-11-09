import test from 'node:test';
import assert from 'node:assert/strict';
import { FLOAT, SOLANA_USDC } from '../src/domain.ts';
import { discoverFloatHistory } from '../src/float-history.ts';
import { SolanaReader } from '../src/solana.ts';

const account=SOLANA_USDC, expectedGenesis='11111111111111111111111111111111';
const a='2'.repeat(87), b='3'.repeat(87), c='4'.repeat(87);
const row=(signature:string,slot:number,err:unknown=null)=>({signature,slot,err,confirmationStatus:'finalized'});
const tx=(signature:string,slot:number,programId=FLOAT)=>({slot,transaction:{signatures:[signature],message:{
  accountKeys:[{pubkey:account,signer:false,writable:true}],instructions:[{programId,accounts:[account],data:'11111112'}]
}},meta:{err:null,innerInstructions:[],preTokenBalances:[],postTokenBalances:[]}});
function fake(rows:unknown, details:Record<string,unknown>, genesis=expectedGenesis) {
  const calls:{method:string;params:unknown[]}[]=[];
  const reader=new SolanaReader(['https://rpc.invalid'],async (_url,init)=>{
    const query=JSON.parse(String(init?.body));
    calls.push(query);
    const result=query.method==='getGenesisHash'?genesis:
      query.method==='getSignaturesForAddress'?rows:details[query.params[0]]??null;
    return Response.json({id:query.id,result});
  });
  return {reader,calls};
}
test('discovers Float candidates using bounded finalized reads without crediting funds',async()=>{
  const {reader,calls}=fake([row(a,30),row(b,29),row(c,28,{InstructionError:[0,'Custom']})],
    {[a]:tx(a,30),[b]:tx(b,29,'11111111111111111111111111111111')});
  const result=await discoverFloatHistory(reader,{account,expectedGenesis,limit:3});
  assert.deepEqual(result.rows.map(x=>x.status),['candidate_only','no_top_level_float','failed_on_chain']);
  assert.equal(result.rows[0].floatCalls?.[0].discriminatorHex,'0000000000000001');
  assert.equal(result.nextBefore,c);
  assert.equal(result.creditAuthorized,false);
  assert.equal(calls.some(q=>q.params[0]===c),false);
  assert.deepEqual(calls[1].params,[account,{commitment:'finalized',limit:3}]);
});
test('does not advance past missing, mismatched or unrelated RPC detail',async()=>{
  for(const detail of [null,tx(a,31),tx(b,30),{...tx(a,30),transaction:{signatures:[a],message:{accountKeys:[],instructions:[]}}}]) {
    const {reader,calls}=fake([row(a,30)],{[a]:detail});
    const result=await discoverFloatHistory(reader,{account,expectedGenesis,limit:1,before:b});
    assert.equal(result.incomplete,true);
    assert.equal(result.rows[0].status,'unresolved');
    assert.equal(result.nextBefore,null);
    assert.deepEqual(calls[1].params,[account,{commitment:'finalized',limit:1,before:b}]);
  }
});
test('rejects wrong clusters and duplicate, out-of-order, nonfinalized, or repeated-cursor rows',async()=>{
  const wrong=fake([],{},FLOAT);
  await assert.rejects(discoverFloatHistory(wrong.reader,{account,expectedGenesis}),/cluster/);
  assert.equal(wrong.calls.length,1);
  for(const rows of [[row(a,30),row(a,29)],[row(a,29),row(c,30)],
    [{...row(a,30),confirmationStatus:'confirmed'}],[row(b,30)]]) {
    const {reader}=fake(rows,{});
    await assert.rejects(discoverFloatHistory(reader,{account,expectedGenesis,before:b}),/history entry/);
  }
});
