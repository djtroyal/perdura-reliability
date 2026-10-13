import assert from 'node:assert/strict'
import test from 'node:test'
import {
  layoutHorizontalGraph,
  layoutVerticalGraph,
  orthogonalConnectorPath,
  rectanglesOverlap,
  orderLayoutNodes, normalizeLayoutOptions, layoutRadialGraph, routeGraphEdges, routedConnectorPath, layoutLargeNestedBlocks,
} from '../src/components/shared/adaptiveDiagramLayout.mjs'

const trioNodes = [
  { id: 'gate', width: 112, height: 90 },
  { id: 'left', type: 'basic', width: 96, height: 100, x: 0 },
  { id: 'middle', type: 'basic', width: 96, height: 100, x: 150 },
  { id: 'right', type: 'basic', width: 96, height: 100, x: 300 },
]
const trioEdges = ['left', 'middle', 'right'].map((target, order) => ({
  id: `edge-${target}`, source: 'gate', target, order,
}))

function box(node, position) {
  return { ...position, width: node.width, height: node.height }
}

test('compact FTA trio forms a centered, collision-free trident', () => {
  const result = layoutVerticalGraph({
    nodes: trioNodes, edges: trioEdges, density: 'compact', viewportWidth: 900,
  })
  assert.deepEqual(new Set(result.staggered), new Set(['left', 'right']))
  assert.equal(result.positions.left.y, result.positions.right.y)
  assert.ok(result.positions.middle.y < result.positions.left.y)

  const gateCenter = result.positions.gate.x + trioNodes[0].width / 2
  const middleCenter = result.positions.middle.x + trioNodes[2].width / 2
  assert.equal(gateCenter, middleCenter)
  for (let left = 0; left < trioNodes.length; left += 1) {
    for (let right = left + 1; right < trioNodes.length; right += 1) {
      assert.equal(rectanglesOverlap(
        box(trioNodes[left], result.positions[trioNodes[left].id]),
        box(trioNodes[right], result.positions[trioNodes[right].id]),
      ), false)
    }
  }
  assert.deepEqual(Object.values(result.routes).map(route => route.lane), [-1, 0, 1])
})

test('comfortable FTA remains a conventional single-row fanout', () => {
  const result = layoutVerticalGraph({
    nodes: trioNodes, edges: trioEdges, density: 'comfortable', viewportWidth: 900,
  })
  assert.deepEqual(result.staggered, [])
  assert.equal(result.positions.left.y, result.positions.middle.y)
  assert.equal(result.positions.middle.y, result.positions.right.y)
})

test('compact trident is viewport-independent; mixed groups stay on one row', () => {
  for (const viewportWidth of [500, 1200, 2400]) {
    const result = layoutVerticalGraph({ nodes: trioNodes, edges: trioEdges, density: 'compact', viewportWidth })
    assert.equal(result.staggered.length, 2)
  }
  const mixed = trioNodes.map(node => node.id === 'middle' ? { ...node, type:'and' } : node)
  assert.deepEqual(layoutVerticalGraph({ nodes:mixed, edges:trioEdges, density:'compact' }).staggered, [])
})

test('dense fanouts from three through twelve stay ordered and collision-free', () => {
  for (let count = 3; count <= 12; count += 1) {
    const children = Array.from({ length: count }, (_, index) => ({
      id: `n${index}`, x: index * 200, type: 'basic', width: 80 + (index % 3) * 22, height: 65 + (index % 4) * 27,
    }))
    const nodes = [{ id: 'gate', width: 112, height: 90 }, ...children]
    const result = layoutVerticalGraph({
      nodes,
      edges: children.map((node, order) => ({ id: `e${order}`, source: 'gate', target: node.id, order })),
      density: 'dense', viewportWidth: 760,
    })
    const centers = children.map(node => result.positions[node.id].x + node.width / 2)
    assert.ok(centers.every((value, index) => index === 0 || value > centers[index - 1]))
    for (let left = 0; left < nodes.length; left += 1) {
      for (let right = left + 1; right < nodes.length; right += 1) {
        assert.equal(rectanglesOverlap(
          box(nodes[left], result.positions[nodes[left].id]),
          box(nodes[right], result.positions[nodes[right].id]),
        ), false, `${count}-way fanout collision: ${nodes[left].id}/${nodes[right].id}`)
      }
    }
  }
})

test('vertical layout is deterministic and applies the requested grid', () => {
  const options = {
    nodes: trioNodes, edges: trioEdges, density: 'dense', viewportWidth: 913,
    snapToGrid: true, gridSize: 20,
  }
  const first = layoutVerticalGraph(options)
  const second = layoutVerticalGraph(options)
  assert.deepEqual(first, second)
  trioNodes.forEach(node => {
    const position = first.positions[node.id]
    assert.equal((position.x + node.width / 2) % 20, 0)
    assert.equal(position.y % 20, 0)
  })
})

test('orthogonal FTA fanouts share a clean bus and aligned children stay straight', () => {
  const left = orthogonalConnectorPath({
    sourceX: 240, sourceY: 200, targetX: 80, targetY: 340,
    orientation: 'vertical', trunk: 'source', offset: 32,
  })
  const right = orthogonalConnectorPath({
    sourceX: 240, sourceY: 200, targetX: 400, targetY: 340,
    orientation: 'vertical', trunk: 'source', offset: 32,
  })
  assert.match(left, /^M 240 200 L 240 232 L 80 232 L 80 340$/)
  assert.match(right, /^M 240 200 L 240 232 L 400 232 L 400 340$/)
  assert.equal(orthogonalConnectorPath({
    sourceX: 240, sourceY: 200, targetX: 240, targetY: 300,
  }), 'M 240 200 L 240 300')
})

test('orthogonal RBD merges share a target-side bus', () => {
  const upper = orthogonalConnectorPath({
    sourceX: 200, sourceY: 120, targetX: 460, targetY: 240,
    orientation: 'horizontal', trunk: 'target', offset: 40,
  })
  const lower = orthogonalConnectorPath({
    sourceX: 200, sourceY: 360, targetX: 460, targetY: 240,
    orientation: 'horizontal', trunk: 'target', offset: 40,
  })
  assert.match(upper, /L 420 120 L 420 240 L 460 240$/)
  assert.match(lower, /L 420 360 L 420 240 L 460 240$/)
})

test('orthogonal RBD paths snap fractional alignment noise and never draw diagonals', () => {
  assert.equal(orthogonalConnectorPath({
    sourceX: 180, sourceY: 240.2, targetX: 460, targetY: 240.6,
    orientation: 'horizontal', trunk: 'target', offset: 40,
  }), 'M 180 240.6 L 460 240.6')
  assert.equal(orthogonalConnectorPath({
    sourceX: 180, sourceY: 240, targetX: 196, targetY: 280,
    orientation: 'horizontal', trunk: 'midpoint', offset: 40,
  }), 'M 180 240 L 188 240 L 188 280 L 196 280')
})

test('FTA preserves current visual order without rewriting semantic edge order', () => {
  const nodes = [
    { id: 'gate', width: 112, height: 90 },
    { id: 'alpha', width: 96, height: 90, x: 500 },
    { id: 'beta', width: 96, height: 90, x: 100 },
    { id: 'gamma', width: 96, height: 90, x: 300 },
  ]
  const result = layoutVerticalGraph({
    nodes,
    edges: [
      { id: 'e-gamma', source: 'gate', target: 'gamma', order: 0 },
      { id: 'e-alpha', source: 'gate', target: 'alpha', order: 1 },
      { id: 'e-beta', source: 'gate', target: 'beta', order: 2 },
    ],
    density: 'compact', viewportWidth: 900,
  })
  const center = id => result.positions[id].x + 48
  assert.ok(center('beta') < center('gamma'))
  assert.ok(center('gamma') < center('alpha'))
})

test('RBD uses measured heights and keeps an isolated chain horizontal', () => {
  const chainNodes = [
    { id: 'source', width: 58, height: 58 },
    { id: 'block', width: 144, height: 132 },
    { id: 'sink', width: 58, height: 58 },
  ]
  const chain = layoutHorizontalGraph({
    nodes: chainNodes,
    edges: [
      { id: 'source-block', source: 'source', target: 'block' },
      { id: 'block-sink', source: 'block', target: 'sink' },
    ],
    density: 'comfortable',
    viewportHeight: 600,
  })
  const centers = chainNodes.map(node => chain.positions[node.id].y + node.height / 2)
  assert.equal(new Set(centers).size, 1)
  assert.ok(chain.positions.source.x < chain.positions.block.x)
  assert.ok(chain.positions.block.x < chain.positions.sink.x)
})

test('mode spacing is independent of the selected connector rendering', () => {
  const nodes = [
    { id: 'source', width: 58, height: 58 },
    { id: 'block', width: 144, height: 80 },
    { id: 'sink', width: 58, height: 58 },
  ]
  const edges = [
    { id: 'source-block', source: 'source', target: 'block' },
    { id: 'block-sink', source: 'block', target: 'sink' },
  ]
  const orthogonal = layoutHorizontalGraph({ nodes, edges, connectorStyle: 'smoothstep' })
  const straight = layoutHorizontalGraph({ nodes, edges, connectorStyle: 'straight' })
  assert.equal(straight.positions.sink.x, orthogonal.positions.sink.x)
  assert.equal(straight.routes['source-block'].offset, orthogonal.routes['source-block'].offset)
})

test('RBD parallel ranks are centered and collision-free', () => {
  const nodes = [
    { id: 'source', width: 58, height: 58 },
    { id: 'short', width: 144, height: 70 },
    { id: 'tall', width: 144, height: 150 },
    { id: 'sink', width: 58, height: 58 },
  ]
  const result = layoutHorizontalGraph({
    nodes,
    edges: [
      { id: 's-short', source: 'source', target: 'short' },
      { id: 's-tall', source: 'source', target: 'tall' },
      { id: 'short-t', source: 'short', target: 'sink' },
      { id: 'tall-t', source: 'tall', target: 'sink' },
    ],
    density: 'dense', viewportHeight: 540,
  })
  assert.equal(rectanglesOverlap(
    box(nodes[1], result.positions.short),
    box(nodes[2], result.positions.tall),
  ), false)
  assert.equal(result.routes['s-short'].lane, -0.5)
  assert.equal(result.routes['s-tall'].lane, 0.5)
})

test('cyclic residue is placed without looping or disappearing', () => {
  const result = layoutVerticalGraph({
    nodes: [{ id: 'a', width: 100, height: 80 }, { id: 'b', width: 100, height: 80 }],
    edges: [{ id: 'ab', source: 'a', target: 'b' }, { id: 'ba', source: 'b', target: 'a' }],
    density: 'comfortable', viewportWidth: 800,
  })
  assert.deepEqual(Object.keys(result.positions).sort(), ['a', 'b'])
  Object.values(result.positions).forEach(position => {
    assert.ok(Number.isFinite(position.x))
    assert.ok(Number.isFinite(position.y))
  })
})


test('all four independent preservation choices honor their mixed visual contract', () => {
  const nodes = ['g1','e1','g2','e2'].map((id,index) => ({ id, kind:id[0]==='g'?'gate':'event', width:100,height:80,x:index*150 }))
  const score = id => ({ e2:0,g2:1,e1:2,g1:3 })[id]
  const order = (preserveGateOrder,preserveEventOrder) => orderLayoutNodes(nodes,
    {mode:'normal',preserveGateOrder,preserveEventOrder,optimizeLabelGeometry:false},false,score).map(n=>n.id)
  assert.deepEqual(order(true,true), ['g1','e1','g2','e2'])
  assert.deepEqual(order(true,false), ['e2','g1','e1','g2'])
  assert.deepEqual(order(false,true), ['e1','g2','e2','g1'])
  assert.deepEqual(order(false,false), ['e2','g2','e1','g1'])
})

test('shared DAG preserves captured visual order and inputs remain byte-identical', () => {
  const nodes = ['A','B','X','Y'].map((id,i)=>({id,width:100,height:80,x:i*150}))
  const edges = [{id:'AX',source:'A',target:'X',order:0,role:'priority'},
    {id:'AY',source:'A',target:'Y',order:1,role:'blocker'}, {id:'BX',source:'B',target:'X',order:0}]
  const before = JSON.stringify({nodes,edges})
  for (const mode of ['compact','normal','expanded']) {
    const options={nodes,edges,layoutOptions:normalizeLayoutOptions({mode})}
    const result=layoutVerticalGraph(options)
    assert.ok(result.positions.X.x < result.positions.Y.x)
    assert.deepEqual(result,layoutVerticalGraph(options))
  }
  assert.equal(JSON.stringify({nodes,edges}),before)
})

test('wide middle trident reserves stem clearance; label optimization reduces actual area', () => {
  const nodes = trioNodes.map(node => node.id==='middle' ? {...node,width:360,height:180} : node.id==='left' ? {...node,height:160} : node)
  const options={nodes,edges:trioEdges,layoutOptions:normalizeLayoutOptions({mode:'compact'})}
  const before=layoutVerticalGraph(options)
  const middle=before.positions.middle
  assert.ok(before.positions.left.x+48 <= middle.x-8)
  assert.ok(before.positions.right.x+48 >= middle.x+360+8)
  assert.ok(Object.values(before.routes).every(route=>route.obstructionCount===0))
  const optimized=layoutVerticalGraph({...options,layoutOptions:normalizeLayoutOptions({mode:'compact',preserveEventOrder:false,optimizeLabelGeometry:true})})
  const area = result => {
    const boxes=nodes.map(n=>({...result.positions[n.id],width:n.width,height:n.height}))
    return (Math.max(...boxes.map(b=>b.x+b.width))-Math.min(...boxes.map(b=>b.x)))
      *(Math.max(...boxes.map(b=>b.y+b.height))-Math.min(...boxes.map(b=>b.y)))
  }
  assert.ok(area(optimized)<area(before))
})

test('obstructed orthogonal connections select clear outside corridors', () => {
  const nodes=[{id:'a',width:80,height:80},{id:'b',width:80,height:80},{id:'obstacle',width:100,height:180}]
  const edges=[{id:'ab',source:'a',target:'b'}]
  const positions={a:{x:0,y:100},b:{x:500,y:100},obstacle:{x:220,y:50}}
  const route=routeGraphEdges(nodes,edges,positions,'horizontal',42).ab
  assert.equal(route.obstructionCount,0)
  assert.equal(route.points.length,6)
  const path=routedConnectorPath({sourceX:80,sourceY:140,targetX:500,targetY:140,orientation:'horizontal'},route)
  assert.ok(path.includes('L'))
  assert.notEqual(path,'M 80 140 L 500 140')
})

test('radial modes and measured optimization retain clockwise order and do not overlap', () => {
  const nodes=Array.from({length:7},(_,i)=>({id:`s${i}`,x:300*Math.cos(i),y:300*Math.sin(i),width:i===0?280:110,height:i===0?180:90}))
  const bounds=[]
  for(const mode of ['compact','normal','expanded']) {
    const options={nodes,layoutOptions:normalizeLayoutOptions({mode,optimizeLabelGeometry:true}),initialId:'s0'}
    const result=layoutRadialGraph(options)
    assert.deepEqual(result,layoutRadialGraph(options))
    for(let i=0;i<nodes.length;i++) for(let j=i+1;j<nodes.length;j++) assert.equal(rectanglesOverlap(box(nodes[i],result.positions[nodes[i].id]),box(nodes[j],result.positions[nodes[j].id])),false)
    bounds.push(Math.max(...Object.values(result.positions).map(p=>p.x))-Math.min(...Object.values(result.positions).map(p=>p.x)))
  }
  assert.ok(bounds[0]<bounds[1] && bounds[1]<bounds[2])
})

test('large layouts keep every node and edge with bounded routing work', () => {
  const nodes=Array.from({length:1000},(_,i)=>({id:`n${i}`,width:120,height:90,x:i*140}))
  const edges=nodes.slice(1).map((node,i)=>({id:`e${i}`,source:`n${Math.floor(i/3)}`,target:node.id}))
  const result=layoutVerticalGraph({nodes,edges,layoutOptions:normalizeLayoutOptions({mode:'compact',optimizeLabelGeometry:true})})
  assert.equal(Object.keys(result.positions).length,1000)
  assert.equal(Object.keys(result.routes).length,999)
  assert.ok(Object.values(result.routes).every(route=>route.obstructionCount===undefined))
})


test('multiple contiguous trident groups retain their visual order and clear each other', () => {
  const nodes=['p','q'].map((id,i)=>({id,width:120,height:80,x:i*700}))
  const edges=[]
  for(let group=0;group<2;group++) for(let i=0;i<3;i++) {
    const id=`${group}-${i}`
    nodes.push({id,type:'basic',width:i===1?240:100,height:100,x:group*700+i*200})
    edges.push({id:'e'+id,source:group?'q':'p',target:id})
  }
  const result=layoutVerticalGraph({nodes,edges,density:'compact'})
  assert.equal(result.staggered.length,4)
  for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++)assert.equal(rectanglesOverlap(box(nodes[i],result.positions[nodes[i].id]),box(nodes[j],result.positions[nodes[j].id])),false)
  assert.ok(Object.values(result.routes).every(route=>route.obstructionCount===0))
})

test('deep assembly fallback is iterative, preserves every block and grows containment', () => {
  const nodes=Array.from({length:2000},(_,i)=>({id:'n'+i,parentId:i?'n'+(i-1):undefined,expanded:true,insideBoundary:true,kind:'gate',width:180,height:72,x:i*24,y:i*52}))
  const result=layoutLargeNestedBlocks(nodes,{x:0,y:0,width:300,height:200},normalizeLayoutOptions({mode:'compact'}))
  assert.equal(Object.keys(result.positions).length,2000)
  assert.ok(result.boundary.width>2000*20)
  assert.ok(result.positions.n1999.y>result.positions.n1998.y)
})
