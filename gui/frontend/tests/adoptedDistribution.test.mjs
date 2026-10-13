import assert from 'node:assert/strict'
import { test } from 'node:test'
import { adoptDistribution, createFitProvenance, extractLifeObservations, lifeDataObservationSignature,
  isLifeDataObservationCurrent, resolveAdoptedDistribution, resolveDistributionSource,
  distributionRunSnapshot, validateDistributionParameters, lifeDataComparisonObservations } from '../src/components/shared/adoptedDistribution.ts'
import { quantityConversionFactor } from '../src/components/shared/datasetUnits.ts'
import { resolveSsiSide, ssiInputFingerprint } from '../src/components/LifeData/stressStrengthModel.ts'

const options={projectUnit:'hours',engineRevision:2}
const fixture=()=>({id:'a',name:'Dataset A',dataSource:'table',dataFormat:'individual',method:'MLE',ci:.95,
  rows:[{key:'one',id:'pump',time:'100',state:'F'},{key:'two',id:'pump',time:'200',state:'F'},{time:'300',state:'S'}],
  result:{CI:.95,best_distribution:'Weibull_2P',results:[
    {Distribution:'Weibull_2P',fit_eligible:true,params:{eta:180,beta:2},method:'MLE'},
    {Distribution:'Normal_2P',fit_eligible:true,params:{mu:150,sigma:50},method:'MLE'},
    {Distribution:'Lognormal_2P',fit_eligible:false,params:{mu:4,sigma:1}}]}})
const fitted=()=>{const f=fixture();f.dataSig=lifeDataObservationSignature(f);f.fitProvenance=createFitProvenance(f,options);return f}
const adopted=()=>{const f=fitted();f.adoptedDistribution=adoptDistribution(f,'Normal_2P',options);return f}

test('numeric canonical observations ignore row identity, ordering, padding and numeric spelling',()=>{
  const f=fixture(), changed={...f,rows:[{time:'',state:'F'},...f.rows.toReversed().map(r=>({...r,key:'new',id:'renamed',time:` ${Number(r.time).toExponential()} `}))]}
  assert.equal(lifeDataObservationSignature(f),lifeDataObservationSignature(changed))
  assert.notEqual(lifeDataObservationSignature(f),lifeDataObservationSignature({...f,rows:[...f.rows,{time:'20',state:'F'}]}))
  assert.throws(()=>extractLifeObservations({...f,rows:[{time:'20bad',state:'F'}]}),/finite/)
  assert.throws(()=>extractLifeObservations({...f,rows:[{time:'',state:'F',id:'measured unit'}]}),/observation value/)
})
test('frequency and interval signatures include observation semantics, not UI row keys',()=>{
  const frequency={...fixture(),dataFormat:'frequency',frequencyRows:[{key:'a',id:'x',time:'10',state:'F',count:'3'}]}
  assert.deepEqual(extractLifeObservations(frequency),{observation_model:'frequency_exact',frequency_observations:[{time:10,state:'F',count:3}]})
  assert.notEqual(lifeDataObservationSignature(frequency),lifeDataObservationSignature({...frequency,frequencyRows:[{time:'10',state:'F',count:'4'}]}))
  const interval={...fixture(),dataFormat:'interval',intervalRows:[{lower:'',upper:'10',count:'2'},{lower:'20',upper:'',count:'1'}]}
  assert.deepEqual(extractLifeObservations(interval).interval_observations,[{lower:null,upper:10,count:2},{lower:20,upper:null,count:1}])
  assert.throws(()=>extractLifeObservations({...interval,intervalRows:[{lower:'10',upper:'9',count:'1'}]}),/lower/)
  assert.throws(()=>extractLifeObservations({...frequency,frequencyRows:[{time:'',state:'F',count:'4'}]}),/observation value/)
  assert.throws(()=>extractLifeObservations({...interval,intervalRows:[{lower:'',upper:'',count:'4'}]}),/at least one bound/)
})
test('both legacy signatures verify unchanged data; absent provenance is unconfirmed',()=>{
  const f=fixture(), rows=f.rows.map(r=>({t:r.time,s:r.state}))
  for(const dataSig of [JSON.stringify(rows),JSON.stringify({format:'individual',observations:rows}),lifeDataObservationSignature(f)]) {
    assert.equal(isLifeDataObservationCurrent({...f,dataSig}),true)
  }
  assert.equal(resolveAdoptedDistribution(f,options).status,'unconfirmed')
  assert.throws(()=>adoptDistribution(f,'Normal_2P',options),/Refit/)
})
test('adoption selects exact non-best parameters; no ineligible or implicit best fallback',()=>{
  const f=adopted(), resolved=resolveAdoptedDistribution(f,options)
  assert.equal(resolved.status,'current');assert.deepEqual(resolved.model.parameters,{mu:150,sigma:50})
  assert.equal(resolved.model.distribution,'Normal_2P')
  assert.throws(()=>adoptDistribution(f,'Lognormal_2P',options),/eligible/)
  assert.equal(resolveDistributionSource([f],{module:'lifeData',analysisId:'missing'},options).status,'missing')
})
test('exploration modes/settings and unchanged-data refits preserve adopted parameters',()=>{
  const f=adopted(), changed={...f,analysisMode:'stressstrength',selectedDist:'Weibull_2P',method:'RRX',ci:.8,selectedDists:['Weibull_2P'],
    result:{...f.result,results:[{Distribution:'Normal_2P',fit_eligible:true,params:{mu:999,sigma:5}}]}}
  const source=resolveAdoptedDistribution(changed,options)
  assert.equal(source.status,'current');assert.equal(source.model.parameters.mu,150)
  assert.equal(source.fingerprint,resolveAdoptedDistribution(f,options).fingerprint)
})
test('observations, unit identity and engine changes invalidate; tampered snapshot is rejected',()=>{
  const f=adopted()
  assert.equal(resolveAdoptedDistribution({...f,rows:[...f.rows,{time:'400',state:'F'}]},options).status,'stale')
  assert.equal(resolveAdoptedDistribution({...f,quantity:{kind:'time',unit:'days'}},options).status,'stale')
  assert.equal(resolveAdoptedDistribution(f,{...options,engineRevision:3}).status,'stale')
  assert.equal(resolveAdoptedDistribution({...f,adoptedDistribution:{...f.adoptedDistribution,parameters:{mu:999,sigma:50}}},options).status,'incompatible')
})
test('specified adoption ignores generation/display controls but tracks numeric model edits',()=>{
  let f={...fixture(),dataSource:'spec',spec:{distribution:'Normal_2P',params:{mu:'100',sigma:'2'},mcMode:'single',seed:'123'},
    specResult:{distribution:'Normal_2P',params:{mu:100,sigma:2}}}
  f={...f,fitProvenance:createFitProvenance(f,options)}
  f={...f,adoptedDistribution:adoptDistribution(f,'Normal_2P',options)}
  assert.equal(resolveAdoptedDistribution({...f,spec:{...f.spec,seed:'456'}},options).status,'current')
  assert.equal(resolveAdoptedDistribution({...f,spec:{...f.spec,params:{mu:'101',sigma:'2'}}},options).status,'stale')
})
test('quantity conversion supports pressure, force and custom equality; incompatible domains fail',()=>{
  assert.equal(quantityConversionFactor({kind:'pressure',unit:'MPa'},{kind:'pressure',unit:'Pa'}),1e6)
  assert.equal(quantityConversionFactor({kind:'time',unit:'days'},{kind:'time',unit:'hours'}),24)
  assert.equal(quantityConversionFactor({kind:'force',unit:'kN'},{kind:'force',unit:'N'}),1000)
  assert.equal(quantityConversionFactor({kind:'custom',unit:'widgets'},{kind:'custom',unit:'widgets'}),1)
  assert.throws(()=>quantityConversionFactor({kind:'custom',unit:'widgets'},{kind:'custom',unit:'Widgets'}),/exact same/)
  assert.throws(()=>quantityConversionFactor({kind:'force',unit:'N'},{kind:'pressure',unit:'Pa'}),/Incompatible/)
})
test('SSI live input preserves exact adopted values and invalidates on selection/source changes',()=>{
  const f=adopted(), input={mode:'dataset',source:{module:'lifeData',analysisId:f.id}}
  assert.deepEqual(resolveSsiSide(input,[f],options).parameters,{mu:150,sigma:50})
  assert.equal(distributionRunSnapshot(resolveAdoptedDistribution(f,options)).source.analysisId,'a')
  const manual={mode:'manual',distribution:'Normal_2P',parameters:{mu:'160',sigma:'5'},quantity:{kind:'time',unit:'hours'}}
  const signature=ssiInputFingerprint([input,manual],f,[f],options)
  assert.notEqual(signature,ssiInputFingerprint([input,{...manual,parameters:{mu:'161',sigma:'5'}}],f,[f],options))
  assert.throws(()=>resolveSsiSide({...manual,parameters:{}},[f],options),/Missing/)
  assert.throws(()=>ssiInputFingerprint([{mode:'group'},manual],f,[f],options),/ID groups/)
})
test('common-family comparisons normalize observations without changing stored model parameters',()=>{
  const a={...fixture(),quantity:{kind:'pressure',unit:'MPa'}}
  const b={...fixture(),id:'b',quantity:{kind:'pressure',unit:'kPa'},rows:a.rows.map(row=>({...row,time:String(Number(row.time)*1000)}))}
  const input=lifeDataComparisonObservations([a,b],options)
  assert.deepEqual(input.quantity,a.quantity)
  assert.deepEqual(input.folios[0].failures,input.folios[1].failures)
  assert.deepEqual(input.folios[0].right_censored,input.folios[1].right_censored)
  assert.equal(b.rows[0].time,'100000')
  assert.throws(()=>lifeDataComparisonObservations([a,{...b,quantity:{kind:'time',unit:'hours'}}],options),/Incompatible/)
})
test('parameter validation handles signed location and rejects nonfinite or absent values',()=>{
  assert.deepEqual(validateDistributionParameters('Normal_2P',{mu:-2,sigma:1}),{mu:-2,sigma:1})
  assert.throws(()=>validateDistributionParameters('Weibull_2P',{eta:100,beta:0}),/Invalid/)
  assert.throws(()=>validateDistributionParameters('Normal_2P',{mu:Infinity,sigma:1}),/Invalid/)
  assert.throws(()=>validateDistributionParameters('Normal_2P',{mu:' ',sigma:1}),/Missing/)
  assert.throws(()=>validateDistributionParameters('Normal_2P',{mu:[],sigma:1}),/Invalid/)
  assert.throws(()=>validateDistributionParameters('Weibull_3P',{eta:100,beta:2,gamma:-1}),/Invalid/)
  assert.equal(resolveAdoptedDistribution({...adopted(),adoptedDistribution:{...adopted().adoptedDistribution,schemaVersion:99}},options).status,'incompatible')
})
