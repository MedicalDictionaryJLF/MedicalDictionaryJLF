"""Generate reusable hospital rooms in metre scale; Blender 4.5, no external assets."""
import argparse,math,sys
from pathlib import Path
import bpy
from mathutils import Vector
p=argparse.ArgumentParser();p.add_argument('--output',required=True);p.add_argument('--source-output',default='');args=p.parse_args(sys.argv[sys.argv.index('--')+1:]);OUT=Path(args.output);OUT.mkdir(parents=True,exist_ok=True);SOURCE=Path(args.source_output) if args.source_output else None
if SOURCE:SOURCE.mkdir(parents=True,exist_ok=True)
def material(name,color,roughness=.65,metal=0,emission=0):
 m=bpy.data.materials.new(name);m.use_nodes=True;s=m.node_tree.nodes.get('Principled BSDF');s.inputs['Base Color'].default_value=(*color,1);s.inputs['Roughness'].default_value=roughness;s.inputs['Metallic'].default_value=metal
 if emission:s.inputs['Emission Color'].default_value=(*color,1);s.inputs['Emission Strength'].default_value=emission
 return m
def group(name,parent=None):
 g=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(g)
 if parent:g.parent=parent
 return g
def box(name,loc,size,mat,bevel=.015,parent=None):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.name=name;o.dimensions=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 if bevel:
  mod=o.modifiers.new('Soft manufactured edges','BEVEL');mod.width=bevel;mod.segments=3;bpy.ops.object.modifier_apply(modifier=mod.name)
 o.data.materials.append(mat)
 if parent:o.parent=parent
 return o
def tube(name,a,b,radius,mat,parent=None):
 a=Vector(a);b=Vector(b);d=b-a;bpy.ops.mesh.primitive_cylinder_add(vertices=12,radius=radius,depth=d.length,location=(a+b)*.5);o=bpy.context.object;o.name=name;o.rotation_euler=d.to_track_quat('Z','Y').to_euler();o.data.materials.append(mat)
 for f in o.data.polygons:f.use_smooth=True
 if parent:o.parent=parent
 return o
def chair(m):
 g=group('ExamChair');fabric,metal=m['fabric'],m['metal'];box('ChairSeat',(0,.025,.445),(.57,.54,.085),fabric,.04,g);back=box('ChairBack',(0,.26,.91),(.57,.09,.83),fabric,.04,g);back.rotation_euler.x=math.radians(-5)
 for x in [-.23,.23]:
  for y in [-.17,.23]:tube('ChairLeg',(x,y,.03),(x,y,.415),.022,metal,g)
 for x in [-.32,.32]:box('ArmRest',(x,.015,.69),(.075,.46,.055),fabric,.02,g);tube('ArmSupport',(x,.17,.43),(x,.17,.68),.018,metal,g)
 return g
def bed(m):
 g=group('HospitalBed');box('BedUnderframe',(0,0,.27),(.79,1.98,.09),m['metal'],.025,g);box('Mattress',(0,0,.66),(.88,2.,.14),m['linen'],.065,g);box('MattressBase',(0,0,.55),(.89,2.03,.07),m['white'],.025,g)
 for x in [-.29,.29]:
  for y in [-.73,.73]:
   tube('BedTelescopicLeg',(x,y,.12),(x,y,.51),.03,m['metal'],g);bpy.ops.mesh.primitive_torus_add(major_radius=.045,minor_radius=.014,major_segments=16,minor_segments=8,location=(x,y,.06),rotation=(math.pi/2,0,0));o=bpy.context.object;o.name='Castor';o.data.materials.append(m['rubber']);o.parent=g
 for y in [-1.04,1.04]:box('BedEndBoard',(0,y,.79),(.96,.065,.37),m['white'],.055,g);box('BedEndInsert',(0,y-.035,.82),(.66,.018,.15),m['accent'],.035,g)
 for x in [-.49,.49]:
  for y in [-.55,.55]:tube('SafetyRailUpright',(x,y,.54),(x,y,.88),.018,m['metal'],g)
  tube('SafetyRail',(x,-.55,.88),(x,.55,.88),.02,m['metal'],g)
 pillow=box('Pillow',(0,.65,.79),(.65,.43,.15),m['linen'],.07,g);pillow.rotation_euler.x=-.07
 vertices=[];faces=[];nx,ny=24,44
 for iy in range(ny+1):
  y=-.88+iy/ny*1.37
  for ix in range(nx+1):
   x=-.44+ix/nx*.88;z=.745+.012*math.sin(x*22+y*9)+.006*math.cos(y*27+x*4);vertices.append((x,y,z))
 for iy in range(ny):
  for ix in range(nx):a=iy*(nx+1)+ix;faces.append((a,a+1,a+nx+2,a+nx+1))
 mesh=bpy.data.meshes.new('BlanketMesh');mesh.from_pydata(vertices,[],faces);mesh.update();ob=bpy.data.objects.new('FoldedCover',mesh);bpy.context.collection.objects.link(ob);ob.parent=g;ob.location.z=.035;ob.data.materials.append(m['blanket'])
 for f in mesh.polygons:f.use_smooth=True
 g.location=(1.55,.45,0);return g
def equipment(m):
 monitor=group('BedsideMonitor');box('MonitorCase',(-.95,.38,1.16),(.43,.12,.32),m['white'],.025,monitor);box('MonitorScreen',(-.95,.312,1.17),(.365,.015,.245),m['screen'],.008,monitor);tube('MonitorPole',(-.95,.42,.09),(-.95,.42,1.),.023,m['metal'],monitor)
 for a in range(5):
  angle=a*math.tau/5;tube('MonitorBase',(-.95,.42,.07),(-.95+math.cos(angle)*.25,.42+math.sin(angle)*.25,.07),.018,m['metal'],monitor)
 iv=group('IVEquipment');tube('IVPole',(.78,.36,.08),(.78,.36,1.96),.012,m['metal'],iv);tube('IVHooks',(.57,.36,1.94),(.99,.36,1.94),.01,m['metal'],iv);box('InfusionBag',(.92,.36,1.71),(.105,.05,.23),m['iv'],.025,iv)
 for a in range(5):
  angle=a*math.tau/5;tube('IVBase',(.78,.36,.07),(.78+math.cos(angle)*.22,.36+math.sin(angle)*.22,.07),.014,m['metal'],iv)
 oxygen=group('OxygenEquipment');box('OxygenWallPanel',(-1.6,2.32,1.45),(.33,.06,.18),m['white'],.016,oxygen);tube('FlowMeter',(-1.6,2.26,1.13),(-1.6,2.26,1.51),.022,m['iv'],oxygen)
 return monitor
def make_room(kind,accent):
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False);bpy.data.orphans_purge(do_local_ids=True,do_linked_ids=True,do_recursive=True)
 m={'wall':material('WarmClinicalWall',(.72,.76,.75)),'floor':material('SeamlessHospitalFloor',(.39,.44,.43),.83),'accent':material('RoomAccent',accent),'white':material('MedicalPolymer',(.82,.85,.84),.48),'metal':material('BrushedSteel',(.42,.45,.46),.31,.68),'rubber':material('Rubber',(.025,.032,.035),.9),'linen':material('CottonLinen',(.77,.80,.76),.96),'blanket':material('WovenCover',(.33,.44,.46),.94),'fabric':material('ChairUpholstery',(.24,.32,.32),.76),'screen':material('InactiveMonitorScreen',(.005,.016,.017),.32),'iv':material('ClinicalEquipmentPlastic',(.57,.71,.72),.22),'light':material('LuminousFixture',(.9,.96,1),.4,0,2),'wood':material('LightAshDoor',(.49,.40,.3),.77),'glass':material('DaylightWindow',(.52,.69,.76),.35,.08,.24)}
 box('RoomFloor',(0,0,-.06),(5.8,5.6,.12),m['floor'],.01);box('BackWall',(0,2.4,1.5),(5.8,.12,3),m['wall'],.01);box('LeftWall',(-2.85,.25,1.5),(.12,4.45,3),m['wall'],.01);box('WallProtectionBand',(0,2.325,.94),(5.65,.035,.16),m['accent'],.005);box('Skirting',(0,2.32,.07),(5.7,.04,.14),m['accent'],.005)
 box('WindowFrame',(-1.65,2.3,2.),(1.37,.08,1.23),m['white'],.012);box('WindowGlass',(-1.65,2.25,2.),(1.24,.02,1.1),m['glass'],.002);box('WindowMullion',(-1.65,2.225,2.),(.035,.035,1.1),m['white'],.003)
 box('Door',(1.62,2.3,1.02),(.92,.065,2.04),m['wood'],.012);box('DoorInset',(1.62,2.255,1.5),(.32,.015,.57),m['glass'],.01);tube('DoorHandle',(1.94,2.22,1.04),(1.79,2.22,1.04),.012,m['metal'])
 for x in [-.8,.9]:box('CeilingLuminaire',(x,.4,2.85),(.8,.55,.035),m['light'],.018)
 box('WallMedicalPanel',(-.3,2.29,1.45),(.8,.065,.25),m['white'],.015)
 for x in [-.58,-.32,-.06]:box('PanelOutlet',(x,2.245,1.45),(.11,.025,.1),m['accent'],.008)
 box('Cabinet',(-2.33,1.3,.43),(.65,.58,.86),m['white'],.03);box('CabinetTop',(-2.33,1.3,.89),(.7,.63,.045),m['metal'],.012)
 for z in [.26,.51,.75]:box('DrawerFront',(-2.33,.995,z),(.57,.022,.2),m['white'],.01);tube('DrawerHandle',(-2.42,.97,z),(-2.24,.97,z),.008,m['metal'])
 box('HandRubHolder',(-2.78,.0,1.2),(.07,.17,.23),m['white'],.015);box('WasteBin',(-2.35,-.2,.21),(.29,.29,.42),m['white'],.025);box('WasteBinLid',(-2.35,-.2,.435),(.31,.31,.04),m['accent'],.015)
 chair(m);bed(m);equipment(m)
 if kind=='examination':
  box('WritingSurface',(-1.8,-1.2,.78),(1.25,.6,.05),m['white'],.02)
  for x in [-2.28,-1.32]:tube('DeskLeg',(x,-1.2,.04),(x,-1.2,.75),.025,m['metal'])
 elif kind=='acute':box('EmergencyTrolley',(-1.75,1.5,.5),(.58,.52,.88),m['accent'],.03);box('TrolleyTray',(-1.75,1.5,.96),(.64,.57,.045),m['metal'],.02)
 bpy.context.scene['roomType']=kind;bpy.context.scene['units']='metres';bpy.ops.export_scene.gltf(filepath=str(OUT/(kind+'.glb')),export_format='GLB',export_extras=True,export_animations=False,export_cameras=False,export_lights=False)
 if SOURCE:bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/('room_'+kind+'.blend')),compress=True)
 print('ROOM_COMPLETE',kind,flush=True)
for kind,accent in [('acute',(.27,.47,.47)),('internal',(.40,.48,.36)),('examination',(.4,.45,.55))]:make_room(kind,accent)
