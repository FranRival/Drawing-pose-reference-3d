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
camera.position.set(0, 1.5, 3)

/* RENDERER */
renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(viewer.clientWidth, viewer.clientHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.outputColorSpace = THREE.SRGBColorSpace

// Crucial: Mantiene la lógica de Raycasting para SkinnedMeshes globalmente
THREE.Mesh.prototype.raycast = THREE.SkinnedMesh.prototype.raycast;

viewer.appendChild(renderer.domElement)

/* CONTROLS */
const controls = new OrbitControls(camera, renderer.domElement)

/* LIGHTS */
const light1 = new THREE.DirectionalLight(0xffffff, 1)
light1.position.set(5, 5, 5)
light1.castShadow = true
scene.add(light1)

const light2 = new THREE.AmbientLight(0xffffff, 0.5)
scene.add(light2)

/* GRID */
const grid = new THREE.GridHelper(10, 10)
scene.add(grid)

const axes = new THREE.AxesHelper(5)
scene.add(axes)

/* FLOOR */
const floorGeometry = new THREE.PlaneGeometry(50, 50)
const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x444444 })
const floor = new THREE.Mesh(floorGeometry, floorMaterial)
floor.rotation.x = -Math.PI / 2
floor.receiveShadow = true
scene.add(floor)

/* MODEL LOADER */
const loader = new GLTFLoader()

loader.load(
    'models/mannequin.glb',
    function (gltf) {
        model = gltf.scene
        scene.add(model)

        console.log("====== MODEL HIERARCHY ======")
        printHierarchy(model)
        console.log("====== END HIERARCHY ======")

        window.model = model

        /* activar sombras y preparar geometría */
        model.traverse((obj) => {
            if (obj.isMesh) {
                obj.geometry.computeBoundingBox()
                obj.geometry.computeBoundingSphere()
                obj.castShadow = true
                obj.receiveShadow = true
                
                // Aseguramos que cada mesh use el raycast de SkinnedMesh
                if (obj.isSkinnedMesh) {
                    obj.raycast = THREE.SkinnedMesh.prototype.raycast;
                }
            }
        })

        /* inicializar lógica externa */
        inspectBones()
        initUI()
        initRaycasting()

        /* POSICIONAMIENTO CORRECTO SOBRE EL GRID */
        model.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());

        // Centramos en X y Z, pero en Y usamos el valor mínimo para que pise el suelo (0)
        model.position.x = -center.x;
        model.position.z = -center.z;
        model.position.y = -box.min.y; 

        // Actualizamos matrices después del movimiento para el Raycasting
        model.updateMatrixWorld(true);

        /* Ajuste de Cámara y Controles */
        const maxDim = Math.max(size.x, size.y, size.z);
        camera.position.set(0, size.y * 0.8, size.y * 2);
        
        controls.target.set(0, size.y * 0.5, 0); // Apunta al centro del cuerpo
        controls.update();

        console.log("Modelo posicionado correctamente sobre el grid.");
    },
    (xhr) => { console.log((xhr.loaded / xhr.total * 100) + '% loaded') },
    (error) => { console.error("Error cargando modelo:", error) }
)

function printHierarchy(object, level = 0) {
    const indent = " ".repeat(level * 2)
    console.log(indent + "↳ " + object.type + (object.name ? " | " + object.name : ""))
    for (const child of object.children) {
        printHierarchy(child, level + 1)
    }
}

/* RENDER LOOP */
function animate() {
    requestAnimationFrame(animate)
    renderer.render(scene, camera)
}

/* RESIZE */
window.addEventListener("resize", () => {
    camera.aspect = viewer.clientWidth / viewer.clientHeight
    camera.updateProjectionMatrix()
    renderer.setSize(viewer.clientWidth, viewer.clientHeight)
})

animate()