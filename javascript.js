e03"}
import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js'
import { GLTFLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js'

const viewer = document.getElementById('viewer')

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x222222)

const camera = new THREE.PerspectiveCamera(
    60,
    viewer.clientWidth / viewer.clientHeight,
    0.1,
    1000
)

camera.position.set(0,1.5,3)

const renderer = new THREE.WebGLRenderer({antialias:true})
renderer.setSize(viewer.clientWidth, viewer.clientHeight)

viewer.appendChild(renderer.domElement)

const controls = new OrbitControls(camera, renderer.domElement)

const light1 = new THREE.DirectionalLight(0xffffff,1)
light1.position.set(5,5,5)

scene.add(light1)

const light2 = new THREE.AmbientLight(0xffffff,0.5)
scene.add(light2)

const loader = new GLTFLoader()

loader.load('models/torso.glb', function(gltf){

    const model = gltf.scene
    scene.add(model)

})

function animate(){

    requestAnimationFrame(animate)

    renderer.render(scene,camera)

}

anim