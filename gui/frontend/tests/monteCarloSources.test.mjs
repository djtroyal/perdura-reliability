import assert from 'node:assert/strict'
import {test} from 'node:test'
import {adoptDistribution,createFitProvenance} from '../src/components/shared/adoptedDistribution.ts'
import {resolveMcVariable,resolveMcRun,mcDestinationFingerprint} from '../src/components/LifeData/monteCarloModel.ts'
const options={projectUnit:'hours',engineRevision:2}
function source(mu=42){const f={id:'source',name:'Pressure',dataSource:'spec',quantity:{kind:'pressure',unit:'MPa'},spec:{distribution:'Normal_2P',params:{mu:String(mu),sigma:'2'},mcMode:'single'},specResult:{distribution:'Normal_2P',params:{mu,sigma:2}}};f.fitProvenance=createFitProvenance(f,options);f.adoptedDistribution=adoptDistribution(f,'Normal_2P',options);return f}
const variable={id:'v',name:'A',distribution:'Weibull_2P',params:{eta:'999',beta:'5'},distributionSource:{module:'lifeData',analysisId:'source'}}
const owner=()=>({id:'target',quantity:{kind:'force',unit:'N'},rows:[{time:'1',state:'F'}],spec:{distribution:'Normal_2P',params:{mu:'1',sigma:'2'},mcMode:'equation',mcVariables:[variable],mcEquation:'A * 2',n:'20',seed:'42',genMode:'replace',includeSuspensions:false,suspensionRate:'0',mcId:''}})
test('live variables resolve native adopted parameters and unit, never cached editor parameters',()=>{
 const resolved=resolveMcVariable(variable,[source()],{kind:'force',unit:'N'},options)
 assert.equal(resolved.distribution,'Normal_2P');assert.deepEqual(resolved.parameters,{mu:42,sigma:2});assert.deepEqual(resolved.quantity,{kind:'pressure',unit:'MPa'})
 assert.equal(resolved.source.source.analysisId,'source')
 assert.throws(()=>resolveMcVariable(variable,[],{kind:'force',unit:'N'},options),/missing/)
 const stale=source();stale.spec={...stale.spec,params:{mu:'100',sigma:'2'}}
 assert.throws(()=>resolveMcVariable(variable,[stale],{kind:'force',unit:'N'},options),/changed/)
})
test('generation snapshot changes with sources/configuration, but not renames or destination output',()=>{
 const f=owner(),s=source(),run=resolveMcRun(f,[s],options)
 assert.deepEqual(run.variables[0].parameters,{mu:42,sigma:2});assert.deepEqual(run.outputQuantity,{kind:'force',unit:'N'})
 assert.equal(resolveMcRun(f,[{...s,name:'Renamed'}],options).fingerprint,run.fingerprint)
 assert.notEqual(resolveMcRun(f,[source(43)],options).fingerprint,run.fingerprint)
 assert.notEqual(resolveMcRun({...f,spec:{...f.spec,mcEquation:'A * 3'}},[s],options).fingerprint,run.fingerprint)
 const generated={...f,rows:[{time:'84',state:'F'}]}
 assert.equal(resolveMcRun(generated,[s],options).fingerprint,run.fingerprint)
 assert.notEqual(mcDestinationFingerprint(generated),mcDestinationFingerprint(f))
})
test('manual copy is explicit and malformed sample controls cannot silently coerce',()=>{
 const f=owner(),live=resolveMcVariable(variable,[source()],f.quantity,options)
 const detached={...variable,distributionSource:undefined,distribution:live.distribution,params:{mu:'42',sigma:'2'},quantity:live.quantity}
 assert.equal(resolveMcVariable(detached,[],f.quantity,options).source,undefined)
 for(const n of ['20bad','2.5','0'])assert.throws(()=>resolveMcRun({...f,spec:{...f.spec,n}},[source()],options),/Sample count/)
 assert.throws(()=>resolveMcRun({...f,spec:{...f.spec,seed:'-1'}},[source()],options),/Seed/)
})
