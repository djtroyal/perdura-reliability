import assert from 'node:assert/strict'
import { test } from 'node:test'
import { routeInterfaceConnector, segmentEntersRect } from '../src/components/ReliabilityProgram/interfaceRouting.ts'

const rect = (id,x,y,width=150,height=70) => ({ id,x,y,width,height })
const sample = path => {
  const tokens = path.match(/[MLQ]|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi) ?? []
  const points=[]; let from
  while(tokens.length) {
    const command=tokens.shift(); const x=Number(tokens.shift()); const y=Number(tokens.shift())
    if(command==='M'||command==='L') { from={x,y}; points.push(from) }
    else if(command==='Q') {
      const end={x:Number(tokens.shift()),y:Number(tokens.shift())}
      for(let step=1;step<=32;step++) {
        const t=step/32; points.push({x:(1-t)**2*from.x+2*(1-t)*t*x+t*t*end.x,
          y:(1-t)**2*from.y+2*(1-t)*t*y+t*t*end.y})
      }
      from=end
    } else assert.fail(`Unexpected path command ${command}`)
  }
  return points
}
const assertClear = (route,rectangles) => {
  assert.ok(route.path, 'A route must exist for disjoint accessible endpoints')
  const points=sample(route.path)
  for(let i=1;i<points.length;i++) for(const box of rectangles)
    assert.equal(segmentEntersRect(points[i-1],points[i],box),false,
      `Connector enters ${box.id}: ${JSON.stringify({from:points[i-1],to:points[i],box,path:route.path})}`)
}

for(const style of ['orthogonal','curved','straight']) test(`${style} avoids endpoints, other blocks, and reverse-direction source reentry`,()=>{
  const cases=[
    [rect('a',0,0),rect('b',650,140),[rect('obstacle',270,-40,150,230)]],
    [rect('a',650,0),rect('b',0,140),[rect('obstacle',270,-40,150,300)]],
    [rect('a',0,0),rect('b',0,560),[rect('obstacle',-60,220,250,120)]],
    [rect('a',0,560),rect('b',0,0),[rect('obstacle',-60,220,250,120)]],
    [rect('a',0,0),rect('b',650,0),[rect('near-source',165,-10,100,100),rect('barrier',360,-60,90,260)]],
    [rect('a',0,0),rect('b',650,220),[rect('wall1',230,-100,90,350),rect('wall2',410,170,90,350)]],
  ]
  for(const [source,target,obstacles] of cases) {
    const options={source,target,obstacles:[source,target,...obstacles],style}
    const original=structuredClone(options)
    const route=routeInterfaceConnector(options)
    assertClear(route,options.obstacles)
    assert.deepEqual(routeInterfaceConnector(options),route,'Routing must repeat exactly')
    assert.deepEqual(options,original,'Routing must not change source/model geometry')
    if(style!=='curved') assert.equal(route.path.includes('Q'),false)
  }
})
test('clear Straight connector is direct; obstructed Straight takes a safe detour',()=>{
  const source=rect('a',0,0),target=rect('b',500,100)
  const direct=routeInterfaceConnector({source,target,obstacles:[],style:'straight'})
  assert.equal(direct.points.length,2)
  const obstacle=rect('c',250,-20,100,220)
  const detour=routeInterfaceConnector({source,target,obstacles:[obstacle],style:'straight'})
  assert.ok(detour.points.length>2)
  assertClear(detour,[source,target,obstacle])
})
test('Curved rounds certified clear corners and never bows through its source',()=>{
  const source=rect('a',650,0),target=rect('b',0,150),obstacle=rect('c',270,-40,140,270)
  const route=routeInterfaceConnector({source,target,obstacles:[obstacle]})
  assert.ok(route.path.includes('Q'))
  assertClear(route,[source,target,obstacle])
})
test('self-loop remains outside its own block in each style',()=>{
  const source=rect('a',100,100)
  for(const style of ['orthogonal','curved','straight']) {
    const route=routeInterfaceConnector({source,target:source,obstacles:[],style})
    assertClear(route,[source]); assert.notEqual(route.sourceSide,route.targetSide)
  }
})
test('parallel connector lanes are distinct and avoid blocks',()=>{
  const source=rect('a',0,0),target=rect('b',600,0)
  const routes=[-24,0,24].map(lane=>routeInterfaceConnector({source,target,obstacles:[],lane}))
  assert.equal(new Set(routes.map(route=>route.path)).size,3)
  routes.forEach(route=>assertClear(route,[source,target]))
})
test('a physically impossible contained endpoint is reported instead of drawing through blocks',()=>{
  const route=routeInterfaceConnector({source:rect('a',0,0,400,400),target:rect('b',100,100),obstacles:[]})
  assert.equal(route.path,''); assert.deepEqual(route.points,[])
})
test('a large graph keeps exact obstacle checking without an edge-count shortcut',()=>{
  const source=rect('source',0,0),target=rect('target',600,70)
  const obstacles=Array.from({length:1200},(_,index)=>rect(`other-${index}`,index%40*210,600+Math.floor(index/40)*140))
  obstacles.push(rect('blocking',290,-100,100,350))
  const started=performance.now()
  for(const style of ['orthogonal','curved','straight']) assertClear(routeInterfaceConnector({source,target,obstacles,style}),[source,target,...obstacles])
  const elapsed=performance.now()-started
  assert.ok(elapsed<3000,`Large graph routes took ${elapsed.toFixed(1)}ms`)
})

test('whole-system routing stays interactive for 100 blocks and 150 crossing interfaces',()=>{
  const nodes=Array.from({length:100},(_,i)=>rect(`n${i}`,i%10*270,Math.floor(i/10)*150,180,72))
  const pairs=Array.from({length:150},(_,i)=>[nodes[i%100],nodes[(i*17+23)%100]])
  for(const style of ['orthogonal','curved','straight']) {
    const started=performance.now()
    const routes=pairs.map(([source,target])=>routeInterfaceConnector({source,target,obstacles:nodes,style}))
    const elapsed=performance.now()-started
    assert.equal(routes.filter(route=>!route.path).length,0)
    assert.ok(elapsed<1500,`${style}: ${elapsed.toFixed(1)}ms for 150 interfaces`)
  }
})
