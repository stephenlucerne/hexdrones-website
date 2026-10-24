/* Browser presentation only. This code does not participate in the game simulation. */
(function(root) {
  'use strict';
  const Config = Object.freeze({ radius:.56, obstacleRadius:.9, goalGap:.3, avoidanceGap:.22, speed:2.05, cell:.5, maxDrones:20, spawnSeconds:10, arrival:.12, movingSpeed:.025, fixedStep:1/60 });
  const Gait = Object.freeze({ stepTrigger:.2, maximumLead:.28, leadSeconds:.16, strideDistance:.3, minimumSwing:.12, maximumSwing:.24, startSpacing:.055, lift:.11, movingStance:.82 });
  const RockClusters = [
    {x:6,y:3.2,s:1,variant:0}, {x:12.8,y:-5.2,s:.85,variant:1},
    {x:1.5,y:-6,s:.85,variant:1}, {x:-7,y:5,s:1,variant:0},
    {x:-10,y:-6,s:.7,variant:1}, {x:15,y:8,s:.9,variant:0},
    {x:5.5,y:11,s:.7,variant:1}, {x:-1,y:9,s:.9,variant:1},
    {x:7,y:-13,s:1,variant:0}, {x:-4,y:-15,s:.8,variant:1}
  ];
  // Same six-column silhouettes as the project-owned savannah rock kit.
  const RockRecipes = [
    [[-.28,.28,.64,2.75],[.76,.48,.48,2.02],[-.94,.48,.47,1.62],[-.89,-.39,.51,.89],[.09,-.70,.58,1.28],[.96,-.52,.43,.64]],
    [[-1.02,.34,.50,1.62],[.12,.38,.67,.95],[.94,.14,.48,.55],[-.64,-.65,.54,.63],[.48,-.73,.42,.45],[.92,.73,.30,1.94]]
  ];
  function rocks() {
    return RockClusters.flatMap((c,index)=>RockRecipes[c.variant].map(([x,y,r,h],i)=>({x:c.x+x*c.s,y:c.y+y*c.s,r:r*c.s,h:h*c.s,tint:(index+i)%5})));
  }
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
  function segmentDistance(a,b,p) {
    const x=b.x-a.x,y=b.y-a.y,l=x*x+y*y;
    const t=l?clamp(((p.x-a.x)*x+(p.y-a.y)*y)/l,0,1):0;
    return Math.hypot(a.x+x*t-p.x,a.y+y*t-p.y);
  }
  class Heap {
    constructor(){this.items=[];}
    push(item){let i=this.items.length;this.items.push(item);while(i){const p=(i-1)>>1;if(this.items[p].score<=item.score)break;this.items[i]=this.items[p];i=p;}this.items[i]=item;}
    pop(){const first=this.items[0],last=this.items.pop();if(this.items.length){let i=0;while(i*2+1<this.items.length){let k=i*2+1;if(k+1<this.items.length&&this.items[k+1].score<this.items[k].score)k++;if(this.items[k].score>=last.score)break;this.items[i]=this.items[k];i=k;}this.items[i]=last;}return first;}
    get length(){return this.items.length;}
  }
  class Navigator {
    constructor(obstacles=rocks(),bounds={minX:-31,maxX:31,minY:-30,maxY:30},radius=Config.obstacleRadius) {
      this.obstacles=obstacles;this.bounds=bounds;this.radius=radius;this.cell=Config.cell;
      this.cols=Math.floor((bounds.maxX-bounds.minX)/this.cell)+1;
      this.rows=Math.floor((bounds.maxY-bounds.minY)/this.cell)+1;
      this.blocked=new Uint8Array(this.cols*this.rows);
      for(let id=0;id<this.blocked.length;id++)this.blocked[id]=this.clearPoint(this.point(id))?0:1;
    }
    point(id){return{x:this.bounds.minX+(id%this.cols)*this.cell,y:this.bounds.minY+Math.floor(id/this.cols)*this.cell};}
    id(p){const x=clamp(Math.round((p.x-this.bounds.minX)/this.cell),0,this.cols-1),y=clamp(Math.round((p.y-this.bounds.minY)/this.cell),0,this.rows-1);return y*this.cols+x;}
    clearPoint(p,padding=this.radius){const b=this.bounds;return p.x>=b.minX+padding&&p.x<=b.maxX-padding&&p.y>=b.minY+padding&&p.y<=b.maxY-padding&&!this.obstacles.some(o=>distance(p,o)<o.r+padding+.025);}
    clearSegment(a,b,padding=this.radius){return this.clearPoint(a,padding)&&this.clearPoint(b,padding)&&!this.obstacles.some(o=>segmentDistance(a,b,o)<o.r+padding+.025);}
    nearest(p) {
      const b=this.bounds;
      p={x:clamp(p.x,b.minX+this.radius,b.maxX-this.radius),y:clamp(p.y,b.minY+this.radius,b.maxY-this.radius)};
      if(this.clearPoint(p))return p;
      const origin=this.id(p);let best=-1,bestD=Infinity;
      for(let ring=1;ring<20&&best<0;ring++){
        const ox=origin%this.cols,oy=Math.floor(origin/this.cols);
        for(let y=oy-ring;y<=oy+ring;y++)for(let x=ox-ring;x<=ox+ring;x++){
          if(x<0||x>=this.cols||y<0||y>=this.rows)continue;
          const id=y*this.cols+x;if(this.blocked[id])continue;
          const d=distance(p,this.point(id));if(d<bestD){best=id;bestD=d;}
        }
      }
      return best>=0?this.point(best):null;
    }
    findPath(start,requested,avoid=[]) {
      const goal=this.nearest(requested);if(!goal||!this.clearPoint(start))return [];
      const clear=(a,b)=>this.clearSegment(a,b)&&!avoid.some(o=>segmentDistance(a,b,o)<o.r+(o.padding??this.radius)+.025);
      const blocked=id=>this.blocked[id]||avoid.some(o=>distance(this.point(id),o)<o.r+(o.padding??this.radius)+.025);
      if(clear(start,goal))return[goal];
      const s=this.id(start),n=this.blocked.length;let g=this.id(goal);
      if(blocked(g)){
        let best=-1,bestDistance=Infinity;
        const x=g%this.cols,y=Math.floor(g/this.cols);
        for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){
          const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=this.cols||ny>=this.rows)continue;
          const id=ny*this.cols+nx,p=this.point(id),d=distance(p,goal);
          if(!blocked(id)&&d<bestDistance&&clear(p,goal)){best=id;bestDistance=d;}
        }
        if(best<0)return[];g=best;
      }
      const score=new Float64Array(n);score.fill(Infinity);
      const parent=new Int32Array(n);parent.fill(-1);
      const closed=new Uint8Array(n),open=new Heap();
      score[s]=0;open.push({id:s,score:distance(start,goal)});
      while(open.length){
        const at=open.pop().id;if(closed[at])continue;closed[at]=1;
        if(at===g){
          const path=[goal];let id=g;
          while(id!==s){path.push(this.point(id));id=parent[id];if(id<0)return[];}
          path.push(start);path.reverse();
          const smooth=[];let anchor=0;
          while(anchor<path.length-1){let next=path.length-1;while(next>anchor+1&&!clear(path[anchor],path[next]))next--;smooth.push(path[next]);anchor=next;}
          return smooth;
        }
        const x=at%this.cols,y=Math.floor(at/this.cols);
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
          if(!dx&&!dy)continue;const nx=x+dx,ny=y+dy;
          if(nx<0||ny<0||nx>=this.cols||ny>=this.rows)continue;
          const id=ny*this.cols+nx;if(blocked(id)||closed[id])continue;
          if(dx&&dy&&(blocked(y*this.cols+nx)||blocked(ny*this.cols+x)))continue;
          const a=at===s?start:this.point(at),p=this.point(id);
          if(!clear(a,p))continue;
          const cost=score[at]+Math.hypot(dx,dy)*this.cell;
          if(cost<score[id]){score[id]=cost;parent[id]=at;open.push({id,score:cost+distance(p,goal)});}
        }
      }
      return [];
    }
  }
  class Swarm {
    constructor(nav=new Navigator(),initial={x:8,y:-3},entries=[{x:-20,y:-4},{x:20,y:-4}]) {
      this.nav=nav;this.initial=initial;this.entries=entries;this.reset();
    }
    reset(){this.agents=[];this.clock=0;this.nextSpawn=Config.spawnSeconds;this.target=null;this.active=false;this.add(this.initial);}
    add(point) {
      if(this.agents.length>=Config.maxDrones)return false;
      let p=this.nav.nearest(point);if(!p)return false;
      for(let n=0;n<80&&p&&this.agents.some(a=>distance(a,p)<Config.radius*2+.05);n++)p=this.nav.nearest({x:point.x+Math.cos(n*2.4)*(.8+n*.06),y:point.y+Math.sin(n*2.4)*(.8+n*.06)});
      if(!p||this.agents.some(a=>distance(a,p)<Config.radius*2))return false;
      const agent={id:this.agents.length,x:p.x,y:p.y,vx:0,vy:0,speed:0,heading:-2,goal:{...p},path:[],waypoint:0,blockedSeconds:0,moving:false,progressPoint:{...p},progressTime:0,avoidUntil:0,nextPlan:0};
      this.agents.push(agent);if(this.target)this.assignGoals();return true;
    }
    setTarget(point){this.target=this.nav.nearest(point);this.active=!!this.target;this.assignGoals();}
    assignGoals() {
      if(!this.target)return;const occupied=[];
      for(const a of this.agents){
        let goal=null;
        for(let i=a.id;i<300;i++){
          const r=Config.radius*1.6*Math.sqrt(i),angle=i*2.399963229728653;
          const candidate=this.nav.nearest({x:this.target.x+Math.cos(angle)*r,y:this.target.y+Math.sin(angle)*r});
          if(candidate&&occupied.every(p=>distance(p,candidate)>Config.radius*2+Config.goalGap)){goal=candidate;break;}
        }
        a.goal=goal||{x:a.x,y:a.y};occupied.push(a.goal);
        a.path=this.nav.findPath(a,a.goal);a.waypoint=0;a.blockedSeconds=0;a.progressPoint={x:a.x,y:a.y};a.progressTime=0;a.avoidUntil=0;a.nextPlan=this.clock+.8;a.crowdPath=false;
      }
    }
    setActive(value){this.active=value&&!!this.target;}
    tick(dt) {
      if(dt<=0)return;dt=Math.min(dt,.05);this.clock+=dt;
      if(this.agents.length<Config.maxDrones&&this.clock+1e-6>=this.nextSpawn){
        this.add(this.entries[(this.agents.length-1)%this.entries.length]);this.nextSpawn+=Config.spawnSeconds;
      }
      const previous=this.agents.map(a=>({x:a.x,y:a.y}));
      const proposals=[];
      for(const a of this.agents){
        let vx=0,vy=0;
        const toGoal=distance(a,a.goal),settled=toGoal<Config.arrival;
        a.progressTime+=dt;
        if(a.progressTime>.8){
          if(toGoal>.45&&distance(a,a.progressPoint)<.15)a.avoidUntil=this.clock+4;
          a.progressPoint={x:a.x,y:a.y};a.progressTime=0;
        }
        if(this.active&&!settled){
          if((!a.path.length&&this.clock>=a.nextPlan)||a.blockedSeconds>.8||(a.path.length&&!this.nav.clearSegment(a,a.path[a.waypoint]))||(a.avoidUntil>this.clock&&this.clock>=a.nextPlan)){
            const avoid=a.avoidUntil>this.clock?this.agents.filter(b=>a!==b&&!b.moving).map(b=>({x:b.x,y:b.y,r:Config.radius-.08,padding:Config.radius})):[];
            a.path=this.nav.findPath(a,a.goal,avoid);a.waypoint=0;a.blockedSeconds=0;a.nextPlan=this.clock+.8;a.crowdPath=avoid.length>0;
          }
        }
        if(this.active&&!settled&&a.path.length){
          while(a.waypoint<a.path.length-1&&distance(a,a.path[a.waypoint])<.3)a.waypoint++;
          // Skip obsolete turns only when the drone's full collision disc has visibility.
          if(!a.crowdPath&&a.waypoint<a.path.length-1&&this.nav.clearSegment(a,a.path[a.waypoint+1]))a.waypoint++;
          const waypoint=a.path[a.waypoint],d=Math.max(.001,distance(a,waypoint));
          const speed=Math.min(Config.speed,toGoal*2.3);
          vx=(waypoint.x-a.x)/d*speed;vy=(waypoint.y-a.y)/d*speed;
          for(const b of this.agents){
            if(a===b)continue;const dx=a.x-b.x,dy=a.y-b.y,dist=Math.hypot(dx,dy),range=Config.radius*2+Config.avoidanceGap;
            if(dist<range&&dist>.001){
              const closing=-(dx*vx+dy*vy)/dist;
              const pressure=Math.max(0,(range-dist)/Config.avoidanceGap);
              vx+=dx/dist*pressure*Config.speed;vy+=dy/dist*pressure*Config.speed;
              if(closing>0&&dist<Config.radius*2+.4){
                const side=1; // A stable right-hand passing rule avoids left/right oscillation.
                vx+=-dy/dist*side*.45;vy+=dx/dist*side*.45;
              }
            }
          }
          const magnitude=Math.hypot(vx,vy);if(magnitude>Config.speed){vx*=Config.speed/magnitude;vy*=Config.speed/magnitude;}
        }
        let p={x:a.x+vx*dt,y:a.y+vy*dt};
        if(!this.nav.clearSegment(a,p)){
          const horizontal={x:p.x,y:a.y},vertical={x:a.x,y:p.y};
          p=this.nav.clearSegment(a,horizontal)?horizontal:this.nav.clearSegment(a,vertical)?vertical:{x:a.x,y:a.y};
        }
        proposals.push(p);
      }
      // Position constraints prevent overlap even when steering is congested.
      for(let pass=0;pass<6;pass++)for(let i=0;i<proposals.length;i++)for(let j=i+1;j<proposals.length;j++){
        const a=proposals[i],b=proposals[j],dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy),minimum=Config.radius*2;
        if(d>=minimum)continue;
        const ux=d>.001?dx/d:1,uy=d>.001?dy/d:0,amount=(minimum-d+.0001)/2;
        const nextA={x:a.x-ux*amount,y:a.y-uy*amount},nextB={x:b.x+ux*amount,y:b.y+uy*amount};
        const canA=this.nav.clearSegment(a,nextA),canB=this.nav.clearSegment(b,nextB);
        if(canA&&canB){Object.assign(a,nextA);Object.assign(b,nextB);}
        else if(canA){const push={x:a.x-ux*amount*2,y:a.y-uy*amount*2};if(this.nav.clearSegment(a,push))Object.assign(a,push);}
        else if(canB){const push={x:b.x+ux*amount*2,y:b.y+uy*amount*2};if(this.nav.clearSegment(b,push))Object.assign(b,push);}
      }
      for(let i=0;i<this.agents.length;i++){
        const a=this.agents[i],p=proposals[i],old=previous[i];
        a.x=p.x;a.y=p.y;a.vx=(p.x-old.x)/dt;a.vy=(p.y-old.y)/dt;a.speed=Math.hypot(a.vx,a.vy);
        a.moving=this.active&&a.speed>Config.movingSpeed;
        if(!a.moving){a.vx=0;a.vy=0;a.speed=0;}
        else {
          const heading=Math.atan2(a.vy,a.vx)+Math.PI/2;
          const difference=Math.atan2(Math.sin(heading-a.heading),Math.cos(heading-a.heading));
          a.heading+=clamp(difference,-Math.PI*2*dt,Math.PI*2*dt);
        }
        a.blockedSeconds=a.moving?0:a.blockedSeconds+dt;
      }
    }
  }
  const rotate=(p,a)=>({x:p.x*Math.cos(a)-p.y*Math.sin(a),y:p.x*Math.sin(a)+p.y*Math.cos(a),z:p.z||0});
  class FootPlanner {
    constructor(legs,agent,scale=.75){
      this.scale=scale;this.cooldown=0;this.priority=agent.id%4;
      this.feet=legs.map(l=>{
        const local={x:l.knee[0]*scale,y:l.knee[1]*scale,z:0},world=rotate(local,agent.heading);
        const position={x:agent.x+world.x,y:agent.y+world.y,z:0};
        return{local,position,start:{...position},target:{...position},progress:1,swinging:false,duration:Gait.maximumSwing,yaw:agent.heading,startYaw:agent.heading,targetYaw:agent.heading};
      });
    }
    update(agent,dt) {
      // Actual collision-resolved travel drives gait; stopped feet do not cycle.
      if(!agent.moving){for(const f of this.feet){f.swinging=false;f.position.z=0;f.progress=1;}return;}
      this.cooldown=Math.max(0,this.cooldown-dt);
      let swinging=0;
      for(const f of this.feet){
        if(!f.swinging)continue;
        f.progress=Math.min(1,f.progress+dt/f.duration);
        const t=f.progress*f.progress*(3-2*f.progress);
        f.position={x:f.start.x+(f.target.x-f.start.x)*t,y:f.start.y+(f.target.y-f.start.y)*t,z:Math.sin(Math.PI*t)*Gait.lift};
        const turn=Math.atan2(Math.sin(f.targetYaw-f.startYaw),Math.cos(f.targetYaw-f.startYaw));f.yaw=f.startYaw+turn*t;
        f.swinging=f.progress<1;if(f.swinging)swinging++;else f.position.z=0;
      }
      if(this.cooldown>0||swinging>=2)return;
      let best=-1,error=Gait.stepTrigger;
      for(let k=0;k<4;k++){
        const i=(k+this.priority)%4,f=this.feet[i];if(f.swinging)continue;
        const local=rotate({x:f.local.x*Gait.movingStance,y:f.local.y*Gait.movingStance},agent.heading),nominal={x:agent.x+local.x,y:agent.y+local.y};
        const d=distance(f.position,nominal);if(d>error){best=i;error=d;}
      }
      if(best<0)return;
      const f=this.feet[best],local=rotate({x:f.local.x*Gait.movingStance,y:f.local.y*Gait.movingStance},agent.heading);
      const lead=Math.min(Gait.maximumLead,agent.speed*Gait.leadSeconds),speed=Math.max(.001,agent.speed);
      f.start={...f.position};f.target={x:agent.x+local.x+agent.vx/speed*lead,y:agent.y+local.y+agent.vy/speed*lead,z:0};
      f.startYaw=f.yaw;f.targetYaw=agent.heading;
      f.progress=0;f.swinging=true;f.duration=clamp(Gait.strideDistance/Math.max(.5,agent.speed),Gait.minimumSwing,Gait.maximumSwing);
      this.cooldown=Math.min(Gait.startSpacing,f.duration*.3);this.priority=(best+1)%4;
    }
  }
  const api={Config,Navigator,Swarm,FootPlanner,rocks,distance,segmentDistance,rotate};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.HexSwarm=api;
})(typeof window!=='undefined'?window:globalThis);
