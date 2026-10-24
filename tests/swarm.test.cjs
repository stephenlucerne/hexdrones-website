const test=require('node:test');
const assert=require('node:assert/strict');
const {Config,Navigator,Swarm,FootPlanner,distance}=require('../dist/swarm.js');
const run=(swarm,seconds)=>{for(let t=0;t<seconds;t+=1/60)swarm.tick(1/60);};
test('rock clearance encloses the full worker while crowd clearance covers its body',()=>{
  const fs=require('node:fs'),vm=require('node:vm');
  const context={window:{}};
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../dist/assets/world-models.js'),'utf8'),context);
  const model=context.window.HEXDRONES_MODELS;
  let maximumRadius=0,triangles=0;
  for(const part of model.parts){
    triangles+=part.positions.length/9;
    for(let i=0;i<part.positions.length;i+=3)maximumRadius=Math.max(maximumRadius,Math.hypot(part.positions[i]+part.origin[0],part.positions[i+1]+part.origin[1])*.75);
  }
  assert.equal(triangles,11628);assert.ok(maximumRadius<Config.obstacleRadius);
  assert.ok(Config.radius<maximumRadius);
  let bodyRadius=0;
  for(const part of model.parts.filter(p=>p.bone==='DEF_Body'))for(let i=0;i<part.positions.length;i+=3)bodyRadius=Math.max(bodyRadius,Math.hypot(part.positions[i]+part.origin[0],part.positions[i+1]+part.origin[1])*.75);
  assert.ok(bodyRadius<Config.radius);
});
test('A* routes the entire drone around a rock with chassis clearance',()=>{
  const nav=new Navigator([{x:0,y:0,r:1.4}]);
  const start={x:-5,y:0},end={x:5,y:0},path=nav.findPath(start,end);
  assert.ok(path.length>1);
  let point=start;
  for(const next of path){assert.ok(nav.clearSegment(point,next));point=next;}
  assert.ok(distance(point,end)<.01);
});
test('a cursor inside a rock resolves to accessible ground',()=>{
  const nav=new Navigator([{x:0,y:0,r:2}]);
  const point=nav.nearest({x:0,y:0});
  assert.ok(nav.clearPoint(point));
  assert.ok(distance(point,{x:0,y:0})>=2+Config.radius);
});
test('a wall that seals the map returns no route, rather than cutting a corner',()=>{
  const wall=Array.from({length:31},(_,i)=>({x:0,y:-15+i,r:.65}));
  const nav=new Navigator(wall,{minX:-10,maxX:10,minY:-10,maxY:10});
  assert.deepEqual(nav.findPath({x:-5,y:0},{x:5,y:0}),[]);
  const swarm=new Swarm(nav,{x:-5,y:0});swarm.setTarget({x:5,y:0});run(swarm,2);
  assert.equal(swarm.agents[0].moving,false);assert.equal(swarm.agents[0].speed,0);
});
test('the worker reaches its destination around rocks and stops',()=>{
  const nav=new Navigator([{x:0,y:0,r:1.4}]);
  const swarm=new Swarm(nav,{x:-5,y:0});swarm.setTarget({x:5,y:0});
  for(let tick=0;tick<540;tick++){swarm.tick(1/60);assert.ok(nav.clearPoint(swarm.agents[0]));}
  assert.ok(distance(swarm.agents[0],swarm.agents[0].goal)<Config.arrival);
  assert.equal(swarm.agents[0].moving,false);
});
test('newcomers alternate entries every ten active seconds, with a twenty drone cap',()=>{
  const swarm=new Swarm(new Navigator([]),{x:0,y:0},[{x:-15,y:0},{x:15,y:0}]);
  run(swarm,9.9);assert.equal(swarm.agents.length,1);
  run(swarm,.2);assert.equal(swarm.agents.length,2);assert.ok(swarm.agents[1].x<0);
  run(swarm,10);assert.equal(swarm.agents.length,3);assert.ok(swarm.agents[2].x>0);
  for(let t=0;t<230;t+=.05)swarm.tick(.05);
  assert.equal(swarm.agents.length,20);
  const clock=swarm.clock;swarm.tick(0);assert.equal(swarm.clock,clock);
  swarm.reset();assert.equal(swarm.agents.length,1);assert.equal(swarm.clock,0);
});
test('a converging group preserves body clearance and comes to rest',()=>{
  const swarm=new Swarm(new Navigator([]),{x:-5,y:-2});
  swarm.add({x:-5,y:0});swarm.add({x:-5,y:2});swarm.add({x:5,y:-2});swarm.add({x:5,y:2});
  swarm.nextSpawn=Infinity;swarm.setTarget({x:0,y:0});
  for(let t=0;t<900;t++){
    swarm.tick(1/60);
    for(let i=0;i<swarm.agents.length;i++)for(let j=i+1;j<swarm.agents.length;j++)assert.ok(distance(swarm.agents[i],swarm.agents[j])>=Config.radius*2-.008);
  }
  assert.equal(swarm.agents.filter(a=>a.moving).length,0);
});
test('twenty drones receive compact goals with body clearance instead of paddle-wide gaps',()=>{
  const swarm=new Swarm(new Navigator([]),{x:0,y:0});
  for(let i=1;i<20;i++)swarm.add({x:-20+(i%10)*4,y:8+Math.floor(i/10)*3});
  swarm.setTarget({x:0,y:0});
  assert.equal(swarm.agents.length,20);
  assert.ok(swarm.agents.every(a=>Math.hypot(a.goal.x,a.goal.y)<5));
  for(let i=0;i<20;i++)for(let j=i+1;j<20;j++)assert.ok(distance(swarm.agents[i].goal,swarm.agents[j].goal)>Config.radius*2);
});
test('straight travel produces longer planted strides with fewer foot cycles',()=>{
  const legs=[{knee:[.7,-.62,.62]},{knee:[-.7,.62,.62]},{knee:[-.7,-.62,.62]},{knee:[.7,.62,.62]}];
  const agent={id:0,x:0,y:0,heading:0,moving:true,speed:2,vx:0,vy:-2};
  const planner=new FootPlanner(legs,agent),strides=[];
  for(let tick=0;tick<120;tick++){
    agent.y-=2/60;planner.update(agent,1/60);
    assert.ok(planner.feet.filter(f=>f.swinging).length<=2);
    for(const foot of planner.feet)if(foot.progress===0)strides.push(distance(foot.start,foot.target));
  }
  assert.ok(strides.length>15&&strides.length<30);
  assert.ok(strides.reduce((sum,d)=>sum+d,0)/strides.length>.5);
});
test('feet advance continuously while travelling and freeze for blocked or idle drones',()=>{
  const legs=[{knee:[.7,-.62,.62]},{knee:[-.7,.62,.62]},{knee:[-.7,-.62,.62]},{knee:[.7,.62,.62]}];
  const agent={id:0,x:0,y:0,heading:0,moving:true,speed:2,vx:2,vy:0};
  const feet=new FootPlanner(legs,agent);
  for(let i=0;i<60;i++){agent.x+=2/60;feet.update(agent,1/60);assert.ok(feet.feet.filter(f=>f.swinging).length<=2);}
  assert.ok(feet.feet.some(f=>f.position.x>.5));
  agent.moving=false;agent.vx=0;agent.speed=0;feet.update(agent,1/60);
  const frozen=feet.feet.map(f=>({...f.position}));
  for(let i=0;i<30;i++)feet.update(agent,1/60);
  assert.deepEqual(feet.feet.map(f=>f.position),frozen);
  assert.ok(feet.feet.every(f=>f.position.z===0&&!f.swinging));
});
test('twenty drones navigate the real rock layout, preserve clearance and settle without crowd oscillation',()=>{
  const nav=new Navigator();
  const swarm=new Swarm(nav,{x:8,y:-2},[{x:-19,y:-3},{x:19,y:-4}]);
  swarm.setTarget({x:7,y:-4});
  for(let tick=0;tick<15000;tick++){
    swarm.tick(1/60);
    for(const a of swarm.agents)assert.ok(nav.clearPoint(a));
    if(tick%60===0)for(let i=0;i<swarm.agents.length;i++)for(let j=i+1;j<swarm.agents.length;j++)assert.ok(distance(swarm.agents[i],swarm.agents[j])>=Config.radius*2-.008);
  }
  assert.equal(swarm.agents.length,20);
  assert.ok(swarm.agents.every(a=>!a.moving));
  assert.ok(swarm.agents.every(a=>distance(a,a.goal)<.3));
});
