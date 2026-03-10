// python -m http.server

import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { inspectBones, initRaycasting } from './viewer.js'
import { initUI } from './ui.js'

export let scene
export let camera
export let renderer
export let model

const viewer = document.getElementById('viewer')

/* SCENE */
scene = new THREE.Scene()
scene.background = new THREE.Color(0x222222)

/* CAMERA */
camera = new THREE.PerspectiveCamera(
60,
viewer.clientWidth / viewer.clientHeight,
0.1,
1000
)

camera.position.set(0,1.5,3)

/* RENDERER */
renderer = new THREE.WebGLRenderer({antialias:true})
renderer.setSize(viewer.clientWidth, viewer.clientHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.physicallyCorrectLights = true
renderer.outputColorSpace = THREE.SRGBColorSpace

THREE.Mesh.prototype.raycast = THREE.SkinnedMesh.prototype.raycast; // Esto hace que el raycasting use la geometría real de los meshes, no la caja estática

viewer.appendChild(renderer.domElement)

/* CONTROLS */
const controls = new OrbitControls(camera, renderer.domElement)

/* LIGHTS */
const light1 = new THREE.DirectionalLight(0xffffff,1)
light1.position.set(5,5,5)
light1.castShadow = true
scene.add(light1)

const light2 = new THREE.AmbientLight(0xffffff,0.5)
scene.add(light2)

/* GRID */
const grid = new THREE.GridHelper(10,10)
scene.add(grid)

const axes = new THREE.AxesHelper(5)
scene.add(axes)

/* FLOOR */
const floorGeometry = new THREE.PlaneGeometry(50,50)
const floorMaterial = new THREE.MeshStandardMaterial({color:0x444444})

const floor = new THREE.Mesh(floorGeometry, floorMaterial)
floor.rotation.x = -Math.PI / 2
floor.receiveShadow = true

scene.add(floor)

/* MODEL LOADER */

const loader = new GLTFLoader()

loader.load(
'models/mannequin.glb',

function(gltf){

model = gltf.scene
scene.add(model)
console.log("====== MODEL HIERARCHY ======")
printHierarchy(model)
console.log("====== END HIERARCHY ======")

/* export para debug desde consola */
window.model = model

/* activar sombras en meshes */

model.traverse((obj)=>{

if(obj.isMesh){

console.log("Mesh found:", obj)

/* importante para raycasting */

obj.geometry.computeBoundingBox()
obj.geometry.computeBoundingSphere()

obj.castShadow = true
obj.receiveShadow = true

}

})

/* detectar huesos */

inspectBones()

/* controles de UI */

initUI()

/* raycasting */

initRaycasting()

/* centrar modelo */

/* centrar modelo - FORMA RECOMENDADA */

/* centrar modelo */
model.updateMatrixWorld(true); // Actualiza antes de medir
const box = new THREE.Box3().setFromObject(model);
const center = box.getCenter(new THREE.Vector3());

model.position.sub(center);
model.updateMatrixWorld(true); // Actualiza después de mover

// En lugar de mover el modelo completo, vamos a mover la posición
// pero asegurando que el esqueleto se entienda con la nueva posición.
model.position.sub(center);

model.traverse((obj) => {
    if (obj.isSkinnedMesh) {
        // Esto obliga al Raycaster a usar la posición real de los huesos 
        // y no la caja estática original
        obj.raycast = THREE.SkinnedMesh.prototype.raycast; 
    }
});

model.updateMatrixWorld(true);

},

function(xhr){

console.log((xhr.loaded / xhr.total * 100) + '% loaded')

},

function(error){

console.error("Error cargando modelo:", error)

}

)


function printHierarchy(object, level = 0){

const indent = " ".repeat(level * 2)

console.log(
indent + "↳ " + object.type + (object.name ? " | " + object.name : "")
)

for(const child of object.children){
printHierarchy(child, level + 1)
}

}

/* RENDER LOOP */


function animate(){

requestAnimationFrame(animate)

renderer.render(scene,camera)

}

/* RESIZE */

window.addEventListener("resize", () => {

camera.aspect = viewer.clientWidth / viewer.clientHeight
camera.updateProjectionMatrix()

renderer.setSize(viewer.clientWidth, viewer.clientHeight)

})

animate()
