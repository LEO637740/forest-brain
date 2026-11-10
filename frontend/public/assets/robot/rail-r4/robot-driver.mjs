// Generated from parameters.json and validation-report.json.
export const CONTRACT = {
  "revision": "R4_candidate",
  "units": "meters",
  "status": "PASS_SAMPLED_NONCONTACT",
  "scope": "Single unapproved yellow sample, non-contact; no actual cutting",
  "coordinates": {
    "blender_to_gltf": "(x,y,z) -> (x,z,-y)",
    "up": "+Y",
    "rail": "+X",
    "toward_tree": "-Z"
  },
  "parking": {
    "external_parent_travel_m": 0.0846424041,
    "constant_during_cycle": true,
    "robot_GLB_origin": [
      0,
      0,
      0
    ],
    "note": "Set external carriage x once. Driver does not move the carriage. Do not apply this offset twice."
  },
  "nominal_geometry_ranges": {
    "extension": [
      0,
      0.54
    ],
    "sliderOffset": [
      -0.4,
      0
    ],
    "toolFeed": [
      0,
      0
    ]
  },
  "poses": {
    "stowed": {
      "extension": 0,
      "sliderOffset": 0,
      "toolFeed": 0
    },
    "clearance": {
      "extension": 0.3,
      "sliderOffset": 0,
      "toolFeed": 0
    },
    "lowered": {
      "extension": 0.3,
      "sliderOffset": -0.3962095672,
      "toolFeed": 0
    },
    "approach": {
      "extension": 0.5296136964,
      "sliderOffset": -0.3962095672,
      "toolFeed": 0
    }
  },
  "path": [
    "stowed",
    "clearance",
    "lowered",
    "approach",
    "lowered",
    "clearance",
    "stowed"
  ],
  "motion_nodes": {
    "ARM_SLIDE": {
      "axis": "local z",
      "formula": "-extension"
    },
    "VERTICAL_SLIDER": {
      "axis": "local y",
      "base": 0.67,
      "formula": ".67 + sliderOffset"
    },
    "TOOL_FEED": {
      "axis": "local z",
      "locked": 0
    },
    "TOOL_TCP": {
      "parent": "TOOL_FEED",
      "position": [
        0,
        0,
        -0.155
      ]
    },
    "ROBOT_RAIL_ANCHOR": {
      "position": [
        0,
        0.82,
        0
      ]
    }
  },
  "review_fixture": {
    "tree_translation_gltf": [
      -0.22,
      0,
      -1.4638956627
    ],
    "tree_sha256": "b6a37a765e76557d2d5637caa235d1f7e48e0c5c184e9527dabcff7e0ee1ec65",
    "sample_local": [
      0.0846424041,
      1.3937904328,
      0.2592819663
    ],
    "target_world_gltf": [
      -0.13535759590000002,
      1.3937904328,
      -1.2046136964
    ],
    "approach_tcp_world_gltf": [
      -0.13535759590000002,
      1.3937904328,
      -1.1746136964
    ],
    "axis_standoff_m": 0.03
  },
  "geometry": {
    "inner_beam_length": 0.71,
    "sleeve_start_y": -0.24,
    "sleeve_end_y": 0.42
  },
  "sampled_validation": {
    "samples": 373,
    "unique_states": 187,
    "max_axis_step_m": 0.005,
    "surface_distance_margin_m": 0.005,
    "not_continuous_safety_proof": true
  },
  "compatibility": "Old R3 railSequence simultaneous extension/lowering is NOT the R4 checked path. Use the six-segment R4 path; toolFeed always zero."
};
export const POSES=Object.freeze(Object.fromEntries(Object.entries(CONTRACT.poses).map(([k,v])=>[k,Object.freeze(v)])));
export const PARKED_TRAVEL_M=CONTRACT.parking.external_parent_travel_m;
export function bindRobot(scene){
 const names=['ROBOT_ROOT','ROBOT_RAIL_ANCHOR','ARM_SLIDE','VERTICAL_SLIDER','TOOL_FEED','TOOL_TCP'];
 const nodes=Object.fromEntries(names.map(name=>{
  const o=scene.getObjectByName(name);if(!o)throw new Error('Missing R4 node: '+name);return [name,o];
 }));
 const near=(a,b)=>Math.abs(a-b)<=1e-7;
 function setPose(input){
  if(CONTRACT.status!=='PASS_SAMPLED_NONCONTACT')throw new Error('R4 candidate not cleared for this sampled rehearsal');
  const p=typeof input==='string'?POSES[input]:input;
  if(!p||Object.values(p).some(v=>!Number.isFinite(v)))throw new Error('Invalid R4 pose');
  const {extension:e,sliderOffset:s,toolFeed:f}=p;
  if(![e,s,f].every(Number.isFinite)||f!==0)throw new RangeError('Tool feed must remain zero');
  const low=POSES.lowered.sliderOffset,ext=POSES.approach.extension,mid=POSES.clearance.extension;
  const onPath=(near(s,0)&&e>=0&&e<=mid)||(near(e,mid)&&s>=low&&s<=0)||(near(s,low)&&e>=mid&&e<=ext);
  if(!onPath)throw new RangeError('Outside R4 evaluated path; nominal axis limits are not arbitrary-pose approval');
  nodes.ARM_SLIDE.position.z=-e;nodes.VERTICAL_SLIDER.position.y=.67+s;nodes.TOOL_FEED.position.z=0;
  scene.updateMatrixWorld(true);return nodes.TOOL_TCP;
 }
 function setPathPose(segment,t){
  if(!Number.isInteger(segment)||segment<0||segment>=CONTRACT.path.length-1||!Number.isFinite(t)||t<0||t>1)
   throw new RangeError('R4 segment 0..5, progress 0..1 required');
  const a=POSES[CONTRACT.path[segment]],b=POSES[CONTRACT.path[segment+1]];
  return setPose(Object.fromEntries(['extension','sliderOffset','toolFeed'].map(k=>[k,a[k]+(b[k]-a[k])*t])));
 }
 return Object.freeze({nodes:Object.freeze(nodes),poses:POSES,setPose,setPathPose,parkedTravelM:PARKED_TRAVEL_M});
}

