import * as THREE from 'three';

const {Config,Navigator,Swarm,FootPlanner,rocks,rotate,distance}=window.HexSwarm;
const model=window.HEXDRONES_MODELS;
const terrain=document.getElementById('terrain');
const canvas=document.getElementById('world');
const pauseButton=document.getElementById('pause');
const countLabel=document.getElementById('swarm-count');
const status=document.getElementById('swarm-status');
const fallback=document.getElementById('scene-fallback');
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
const WorkerScale=.75,MaximumPixelRatio=1.5,CameraHeight=18,MaximumFrameSeconds=.1;
let paused=reducedMotion.matches,visible=true,frameHandle=0,lastTime=0,accumulator=0;
let width=0,height=0,mobile=false,hover=false,pendingTarget=null,requestedTarget=null,lastTargetTime=-1,diagnosticTime=0;
let renderer;
try {renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});}
catch(error){fallback.hidden=false;terrain.dataset.scene='webgl-unavailable';console.error('HEXDRONES scene could not start',error);}

function startScene(){
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,MaximumPixelRatio));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
  const scene=new THREE.Scene();scene.background=new THREE.Color('#bfa774');
  const camera=new THREE.OrthographicCamera(-18,18,9,-9,.1,100);
  camera.up.set(0,0,1);camera.position.set(0,-24,30);camera.lookAt(0,0,0);
  const sunlight=new THREE.DirectionalLight('#fff2d7',2.4);
  sunlight.position.set(-12,-16,28);sunlight.castShadow=true;
  sunlight.shadow.mapSize.set(2048,2048);
  Object.assign(sunlight.shadow.camera,{left:-30,right:30,top:28,bottom:-28,near:1,far:80});
  sunlight.shadow.bias=-.00015;sunlight.shadow.normalBias=.015;
  const ambient=new THREE.HemisphereLight('#e2e7ee','#a1854a',2.2);ambient.position.set(0,0,1);
  scene.add(sunlight,ambient);
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(160,160),new THREE.MeshStandardMaterial({color:'#bba06a',roughness:1}));
  ground.receiveShadow=true;ground.position.z=-.028;scene.add(ground);
  makeGroundPatches(scene);
  const obstacles=rocks();
  const rockColors=['#9a8f7b','#a89c85','#8d897d','#b29c79','#a1937a'];
  const rockMaterials=rockColors.map(color=>new THREE.MeshStandardMaterial({color,roughness:1,flatShading:true}));
  for(const rock of obstacles){
    const geometry=new THREE.CylinderGeometry(rock.r,rock.r,rock.h,6,1);
    geometry.rotateX(Math.PI/2);geometry.rotateZ(Math.PI/6);
    const mesh=new THREE.Mesh(geometry,rockMaterials[rock.tint]);
    mesh.position.set(rock.x,rock.y,rock.h/2);mesh.castShadow=true;mesh.receiveShadow=true;scene.add(mesh);
  }
  makeGrass(scene);
  const nav=new Navigator(obstacles);
  let swarm=new Swarm(nav);
  const visuals=new WorkerVisuals(scene,model);
  const planners=[];
  const routes=new THREE.Group();scene.add(routes);
  const routeDots=new THREE.InstancedMesh(new THREE.CircleGeometry(.032,8),new THREE.MeshBasicMaterial({color:'#88adc8'}),700);
  routeDots.frustumCulled=false;routeDots.count=0;routes.add(routeDots);
  const dotMatrix=new THREE.Matrix4();
  const markerGeometry=new THREE.BufferGeometry().setFromPoints(Array.from({length:49},(_,i)=>new THREE.Vector3(Math.cos(i*Math.PI/24)*.26,Math.sin(i*Math.PI/24)*.26,.035)));
  const marker=new THREE.Line(markerGeometry,new THREE.LineBasicMaterial({color:'#88adc8'}));routes.add(marker);
  const selection=new THREE.Line(markerGeometry.clone().scale(2.6,2.6,1),new THREE.LineBasicMaterial({color:'#e47755',transparent:true,opacity:.85}));
  scene.add(selection);
  const outline=new OutlineRenderer(renderer,scene,camera);
  const raycaster=new THREE.Raycaster(),groundPlane=new THREE.Plane(new THREE.Vector3(0,0,1),0),intersection=new THREE.Vector3();
  const pointerWorld=(nx,ny)=>{
    raycaster.setFromCamera(new THREE.Vector2(nx,ny),camera);
    raycaster.ray.intersectPlane(groundPlane,intersection);
    return{x:intersection.x,y:intersection.y};
  };
  function syncVisuals(dt){
    for(const a of swarm.agents){
      if(!planners[a.id])planners[a.id]=new FootPlanner(model.legs,a,WorkerScale);
      if(dt>0)planners[a.id].update(a,dt);
      visuals.pose(a,planners[a.id]);
    }
    visuals.finish(swarm.agents.length);
    const first=swarm.agents[0];selection.position.set(first.x,first.y,0);
    const count=String(swarm.agents.length).padStart(2,'0')+' / '+Config.maxDrones;
    if(countLabel.textContent!==count){countLabel.textContent=count;countLabel.setAttribute('aria-label',swarm.agents.length+' drones in scene');status.textContent='A new drone joined the swarm. '+swarm.agents.length+' drones.';}
    routes.visible=hover&&!!swarm.target;
    if(routes.visible){
      const path=[new THREE.Vector3(first.x,first.y,.04),...first.path.slice(first.waypoint).map(p=>new THREE.Vector3(p.x,p.y,.04))];
      let dots=0,remainder=0;
      for(let i=1;i<path.length&&dots<700;i++){
        const a=path[i-1],b=path[i],length=a.distanceTo(b);
        for(let at=remainder;at<length&&dots<700;at+=.19){
          const fraction=at/length;dotMatrix.makeTranslation(a.x+(b.x-a.x)*fraction,a.y+(b.y-a.y)*fraction,.045);routeDots.setMatrixAt(dots++,dotMatrix);
        }
        remainder=(remainder-length)% .19;if(remainder<0)remainder+=.19;
      }
      routeDots.count=first.moving?dots:0;routeDots.instanceMatrix.needsUpdate=true;
      marker.position.set(first.goal.x,first.goal.y,0);
    }
  }
  function reset(){
    const origin=pointerWorld(.48,mobile?-.48:-.22);
    swarm.initial=nav.nearest(origin);swarm.entries=[pointerWorld(-1.06,-.25),pointerWorld(1.06,-.4)];
    swarm.reset();swarm.setTarget(swarm.initial);planners.length=0;pendingTarget=null;requestedTarget={...swarm.initial};
    accumulator=0;hover=false;syncVisuals(0);outline.render(routes,selection);
    status.textContent='Swarm reset. One drone ready.';
  }
  function resize(){
    const wasMobile=mobile,first=width===0;
    width=terrain.clientWidth;height=terrain.clientHeight;mobile=width<681;
    const aspect=width/height,viewHeight=mobile?30:CameraHeight;
    camera.left=-viewHeight*aspect/2;camera.right=viewHeight*aspect/2;camera.top=viewHeight/2;camera.bottom=-viewHeight/2;camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
    renderer.setSize(width,height,false);outline.resize(width,height);
    swarm.entries=[pointerWorld(-1.06,-.25),pointerWorld(1.06,-.4)];
    if(first||wasMobile!==mobile)reset();else{syncVisuals(0);outline.render(routes,selection);}
  }
  function aim(event){
    if(event.pointerType==='touch'&&event.type!=='pointerdown')return;
    const rect=terrain.getBoundingClientRect();
    pendingTarget=pointerWorld((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2);
    requestedTarget={...pendingTarget};
    hover=true;
    if(paused){swarm.setTarget(pendingTarget);syncVisuals(0);outline.render(routes,selection);}
  }
  function setPaused(value){
    paused=value;accumulator=0;lastTime=0;
    pauseButton.setAttribute('aria-pressed',String(paused));pauseButton.textContent=paused?'▷':'Ⅱ';
    pauseButton.setAttribute('aria-label',paused?'Resume swarm':'Pause swarm');pauseButton.title=paused?'Resume swarm':'Pause swarm';
    status.textContent=paused?'Swarm paused':'Swarm resumed';
    if(paused)swarm.agents.forEach(a=>{a.moving=false;a.speed=0;});
    syncVisuals(0);outline.render(routes,selection);
  }
  function tick(time){
    const elapsed=lastTime?Math.min((time-lastTime)/1000,MaximumFrameSeconds):0;lastTime=time;
    if(pendingTarget&&time-lastTargetTime>180){
      if(!swarm.target||distance(pendingTarget,swarm.target)>.25)swarm.setTarget(pendingTarget);
      lastTargetTime=time;pendingTarget=null;
    }
    if(!paused){
      accumulator+=elapsed;
      while(accumulator>=Config.fixedStep){swarm.tick(Config.fixedStep);syncVisuals(Config.fixedStep);accumulator-=Config.fixedStep;}
    }
    syncVisuals(0);outline.render(routes,selection);
    if(time-diagnosticTime>500){
      terrain.dataset.droneCount=String(swarm.agents.length);
      terrain.dataset.movingCount=String(swarm.agents.filter(a=>a.moving).length);
      terrain.dataset.simulationSeconds=swarm.clock.toFixed(2);
      terrain.dataset.agents=JSON.stringify(swarm.agents.map(a=>({id:a.id,x:+a.x.toFixed(3),y:+a.y.toFixed(3),moving:a.moving,speed:+a.speed.toFixed(3)})));
      diagnosticTime=time;
    }
    frameHandle=visible&&!document.hidden?requestAnimationFrame(tick):0;
  }
  function resume(){if(!frameHandle&&visible&&!document.hidden){lastTime=0;frameHandle=requestAnimationFrame(tick);}}
  terrain.addEventListener('pointermove',aim);terrain.addEventListener('pointerdown',aim);
  terrain.addEventListener('pointerleave',event=>{if(event.pointerType!=='touch')hover=false;});
  terrain.addEventListener('keydown',event=>{
    const offsets={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,1],ArrowDown:[0,-1]};
    if(offsets[event.key]){
      event.preventDefault();const p=requestedTarget||swarm.initial;
      pendingTarget={x:p.x+offsets[event.key][0]*1.3,y:p.y+offsets[event.key][1]*1.3};requestedTarget={...pendingTarget};hover=true;
      if(paused){swarm.setTarget(pendingTarget);syncVisuals(0);outline.render(routes,selection);}
    }else if(event.code==='Space'){event.preventDefault();setPaused(!paused);}
  });
  pauseButton.addEventListener('click',()=>setPaused(!paused));document.getElementById('reset').addEventListener('click',reset);
  reducedMotion.addEventListener('change',event=>setPaused(event.matches));
  new ResizeObserver(resize).observe(terrain);
  new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;resume();}).observe(terrain);
  document.addEventListener('visibilitychange',resume);
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();setPaused(true);fallback.hidden=false;terrain.dataset.scene='context-lost';});
  canvas.addEventListener('webglcontextrestored',()=>{fallback.hidden=true;terrain.dataset.scene='ready';resize();resume();});
  window.addEventListener('pagehide',()=>{cancelAnimationFrame(frameHandle);frameHandle=0;});
  window.addEventListener('pageshow',resume);
  resize();setPaused(paused);terrain.dataset.scene='ready';resume();
}

function makeGroundPatches(scene){
  const geometry=new THREE.CircleGeometry(1.92,6);geometry.rotateZ(Math.PI/6);
  const material=new THREE.MeshStandardMaterial({roughness:1});
  const mesh=new THREE.InstancedMesh(geometry,material,1600);mesh.receiveShadow=true;
  const matrix=new THREE.Matrix4(),color=new THREE.Color();let i=0;
  for(let row=-19;row<=19;row++)for(let col=-19;col<=19;col++){
    matrix.makeTranslation(col*3.325+(row%2)*1.6625,row*2.88,-.024);
    mesh.setMatrixAt(i,matrix);const variation=Math.sin(row*31.7+col*16.4)*.012;
    color.setHSL(.113,.31,.58+variation);mesh.setColorAt(i,color);i++;
  }
  mesh.count=i;scene.add(mesh);
}

function makeGrass(scene){
  const positions=[],colors=[];let seed=6281;
  const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<180;i++){
    const x=(random()-.5)*55,y=(random()-.5)*48;
    for(let j=0;j<5;j++){
      const angle=random()*Math.PI*2,length=.18+random()*.23,bx=x+Math.cos(angle)*.09,by=y+Math.sin(angle)*.09;
      const sideX=Math.cos(angle)*.022,sideY=Math.sin(angle)*.022;
      positions.push(bx-sideX,by-sideY,.015,bx+sideX,by+sideY,.015,bx+Math.cos(angle)*.18,by+Math.sin(angle)*.18,length);
      for(let k=0;k<3;k++)colors.push(.39,.31,.16);
    }
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.computeVertexNormals();
  const grass=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:1}));grass.castShadow=true;scene.add(grass);
}

class WorkerVisuals{
  constructor(scene,data){
    this.model=data;
    const materials=data.materials.map(m=>new THREE.MeshStandardMaterial({color:new THREE.Color().setRGB(...m.color),roughness:Math.max(.4,m.roughness),metalness:0}));
    this.parts=data.parts.map(p=>{
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p.positions,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(p.normals,3));g.computeBoundingSphere();
      const mesh=new THREE.InstancedMesh(g,materials[p.material],Config.maxDrones);mesh.castShadow=true;mesh.receiveShadow=true;mesh.frustumCulled=false;mesh.count=1;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(mesh);
      return{...p,mesh};
    });
    this.matrix=new THREE.Matrix4();this.scale=new THREE.Vector3(WorkerScale,WorkerScale,WorkerScale);
    this.heading=new THREE.Quaternion();this.axis=new THREE.Vector3(0,0,1);
  }
  pose(a,planner){
    const heading=this.heading.setFromAxisAngle(this.axis,a.heading);
    const bonePoses=new Map();
    const body=rotate({x:this.model.bodyOrigin[0],y:this.model.bodyOrigin[1],z:this.model.bodyOrigin[2]},a.heading);
    bonePoses.set('DEF_Body',{position:new THREE.Vector3(a.x+body.x*WorkerScale,a.y+body.y*WorkerScale,body.z*WorkerScale),quaternion:heading.clone()});
    for(let i=0;i<this.model.legs.length;i++){
      const leg=this.model.legs[i],foot=planner.feet[i].position;
      const hipRest=new THREE.Vector3(...leg.hip),elbowRest=new THREE.Vector3(...leg.elbow),kneeRest=new THREE.Vector3(...leg.knee);
      const hip=hipRest.clone().multiplyScalar(WorkerScale).applyQuaternion(heading).add(new THREE.Vector3(a.x,a.y,0));
      const upper=elbowRest.clone().sub(hipRest),lower=kneeRest.clone().sub(elbowRest);
      const target=new THREE.Vector3(foot.x,foot.y,foot.z+kneeRest.z*WorkerScale);
      const guide=elbowRest.clone().sub(hipRest).applyQuaternion(heading);
      const solved=solveLeg(hip,target,guide,upper.length()*WorkerScale,lower.length()*WorkerScale);
      const upperRotation=new THREE.Quaternion().setFromUnitVectors(upper.clone().normalize().applyQuaternion(heading),solved.elbow.clone().sub(hip).normalize()).multiply(heading);
      const lowerRotation=new THREE.Quaternion().setFromUnitVectors(lower.clone().normalize().applyQuaternion(heading),solved.knee.clone().sub(solved.elbow).normalize()).multiply(heading);
      bonePoses.set('DEF_'+leg.name+'_Upper',{position:hip,quaternion:upperRotation});
      bonePoses.set('DEF_'+leg.name+'_Lower',{position:solved.elbow,quaternion:lowerRotation});
      bonePoses.set('DEF_'+leg.name+'_Paddle',{position:solved.knee,quaternion:new THREE.Quaternion().setFromAxisAngle(this.axis,planner.feet[i].yaw)});
    }
    for(const part of this.parts){
      const pose=bonePoses.get(part.bone);if(!pose)throw new Error('Unmapped worker bone '+part.bone);
      this.matrix.compose(pose.position,pose.quaternion,this.scale);part.mesh.setMatrixAt(a.id,this.matrix);
    }
  }
  finish(count){for(const part of this.parts){part.mesh.count=count;part.mesh.instanceMatrix.needsUpdate=true;}}
}

function solveLeg(hip,target,bendGuide,upper,lower){
  const offset=target.clone().sub(hip),direction=offset.clone().normalize();
  const d=THREE.MathUtils.clamp(offset.length(),Math.abs(upper-lower)+.0001,upper+lower-.0001);
  const bend=bendGuide.clone().addScaledVector(direction,-bendGuide.dot(direction)).normalize();
  const along=(upper*upper-lower*lower+d*d)/(2*d),lift=Math.sqrt(Math.max(0,upper*upper-along*along));
  return{knee:hip.clone().addScaledVector(direction,d),elbow:hip.clone().addScaledVector(direction,along).addScaledVector(bend,lift)};
}

class OutlineRenderer{
  constructor(renderer,scene,camera){
    this.renderer=renderer;this.scene=scene;this.camera=camera;
    this.color=new THREE.WebGLRenderTarget(1,1,{samples:4});
    this.normal=new THREE.WebGLRenderTarget(1,1);this.normal.depthTexture=new THREE.DepthTexture(1,1,THREE.UnsignedIntType);
    this.normalMaterial=new THREE.MeshNormalMaterial();
    this.screen=new THREE.Scene();this.screenCamera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
    this.material=new THREE.ShaderMaterial({depthTest:false,depthWrite:false,uniforms:{colorMap:{value:this.color.texture},normalMap:{value:this.normal.texture},depthMap:{value:this.normal.depthTexture},texel:{value:new THREE.Vector2(1,1)}},
      vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}',
      fragmentShader:`
        uniform sampler2D colorMap;uniform sampler2D normalMap;uniform sampler2D depthMap;uniform vec2 texel;varying vec2 vUv;
        void main(){
          vec3 color=texture2D(colorMap,vUv).rgb;
          vec3 normal=texture2D(normalMap,vUv).rgb;float depth=texture2D(depthMap,vUv).x;float edge=0.;
          for(int i=0;i<4;i++){
            vec2 direction=i==0?vec2(1.,0.):i==1?vec2(-1.,0.):i==2?vec2(0.,1.):vec2(0.,-1.);
            vec2 sampleUv=vUv+direction*texel;
            float de=abs(texture2D(depthMap,sampleUv).x-depth);
            float ne=length(texture2D(normalMap,sampleUv).rgb-normal);
            edge=max(edge,max(smoothstep(.0017,.004,de),smoothstep(.28,.58,ne)));
          }
          gl_FragColor=vec4(mix(color,vec3(.055,.045,.03),edge*.78),1.);
          #include <colorspace_fragment>
        }`});
    this.screen.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),this.material));
  }
  resize(width,height){const density=this.renderer.getPixelRatio();width=Math.round(width*density);height=Math.round(height*density);this.color.setSize(width,height);this.normal.setSize(width,height);this.material.uniforms.texel.value.set(1/width,1/height);}
  render(routes,selection){
    const renderer=this.renderer;renderer.setRenderTarget(this.color);renderer.render(this.scene,this.camera);
    const routeVisible=routes.visible;routes.visible=false;selection.visible=false;
    this.scene.overrideMaterial=this.normalMaterial;renderer.shadowMap.autoUpdate=false;
    renderer.setRenderTarget(this.normal);renderer.render(this.scene,this.camera);
    this.scene.overrideMaterial=null;renderer.shadowMap.autoUpdate=true;routes.visible=routeVisible;selection.visible=true;
    renderer.setRenderTarget(null);renderer.render(this.screen,this.screenCamera);
  }
}

if(renderer) startScene();
