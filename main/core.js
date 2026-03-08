//python -m http.server

import * as THREE from 'three'

import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

const viewer = document.getElementById('viewer')

/* SCENE */
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x222222)

/* CAMERA */
const camera = new THREE.PerspectiveCamera(
60,
viewer.clientWidth / viewer.clientHeight,
0.1,
1000
)

camera.position.set(0,1.5,3)

/* RENDERER */
const renderer = new THREE.WebGLRenderer({antialias:true})
renderer.setSize(viewer.clientWidth, viewer.clientHeight)

viewer.appendChild(renderer.domElement)

/* CONTROLS */
const controls = new OrbitControls(camera, renderer.domElement)

/* TEST CUBE */
const geometry = new THREE.BoxGeometry()
const material = new THREE.MeshStandardMaterial({color:0x00ff00})
const cube = new THREE.Mesh(geometry, material)
scene.add(cube)

/* LIGHTS */
const light1 = new THREE.DirectionalLight(0xffffff,1)
light1.position.set(5,5,5)
scene.add(light1)

const light2 = new THREE.AmbientLight(0xffffff,0.5)
scene.add(light2)

/* GRID */
const grid = new THREE.GridHelper(10,10)
scene.add(grid)

const axes = new THREE.AxesHelper(5)
scene.add(axes)

renderer.physicallyCorrectLights = true
renderer.outputColorSpace = THREE.SRGBColorSpace

/* MODEL LOADER */
const loader = new GLTFLoader()

loader.load(
'models/mannequin.glb',

function(gltf){


const model = gltf.scene
scene.add(model)


model.traverse(function(object){

if(object.isBone){

console.log("Bone:", object.name)

}

})


/* calcular bounding box */
const box = new THREE.Box3().setFromObject(model)
const center = box.getCenter(new THREE.Vector3())
const size = box.getSize(new THREE.Vector3())

/* centrar modelo */
model.position.sub(center)

/* ajustar cámara según tamaño */
const maxDim = Math.max(size.x, size.y, size.z)
camera.position.set(0, maxDim * 1.2, maxDim * 2)

controls.target.set(0, maxDim * 0.5, 0)
controls.update()

console.log("Modelo centrado:", size)


model.scale.set(1,1,1)
model.position.set(0,0,0)

console.log("Modelo cargado correctamente")


},

function(xhr){


console.log((xhr.loaded / xhr.total * 100) + '% loaded')


},

function(error){


console.error("Error cargando modelo:", error)


})

/* LOOP */
function animate(){

requestAnimationFrame(animate)

cube.rotation.x += 0.01
cube.rotation.y += 0.01

renderer.render(scene,camera)

}




animate()
