import { model, camera, renderer, scene } from './core.js'
import * as THREE from 'three'

const raycaster = new THREE.Raycaster()
const mouse = new THREE.Vector2()

export let bones = {}

export function inspectBones() {
    if (!model) return
    bones = {}
    model.traverse((obj) => {
        if (obj.isBone) {
            const name = obj.name.toLowerCase()
            if (name.includes("head")) bones.head = obj
            if (name.includes("neck")) bones.neck = obj
            if (name.includes("leftarm")) bones.leftArm = obj
            if (name.includes("rightarm")) bones.rightArm = obj
            if (name.includes("leftforearm")) bones.leftForeArm = obj
            if (name.includes("rightforearm")) bones.rightForeArm = obj
        }
    })
}

export function rotateBone(name, x, y, z) {
    if (!bones[name]) return
    bones[name].rotation.x = x
    bones[name].rotation.y = y
    bones[name].rotation.z = z
}

export function initRaycasting() {
    renderer.domElement.addEventListener("pointerdown", (event) => {
        const rect = renderer.domElement.getBoundingClientRect()
        
        // Coordenadas normalizadas exactas
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

        raycaster.setFromCamera(mouse, camera)

        // IMPORTANTE: model.updateMatrixWorld(true) asegura que Three.js 
        // sepa dónde quedó el modelo después de centrarlo.
        model.updateMatrixWorld(true);

        // Intersectamos directamente contra el modelo
        const intersects = raycaster.intersectObject(model, true)

        if (intersects.length > 0) {
            // Filtramos para obtener solo la malla
            const hit = intersects.find(i => i.object.isMesh || i.object.isSkinnedMesh)
            
            if (hit) {
                const mesh = hit.object
                console.log("Detectado:", mesh.name)

                if (mesh.isSkinnedMesh) {
                    let closestBone = null
                    let minDistance = Infinity
                    const worldPos = new THREE.Vector3()

                    // Buscamos el hueso más cercano al punto de impacto real
                    mesh.skeleton.bones.forEach((bone) => {
                        bone.getWorldPosition(worldPos)
                        const dist = worldPos.distanceTo(hit.point)
                        if (dist < minDistance) {
                            minDistance = dist
                            closestBone = bone
                        }
                    })

                    if (closestBone) {
                        console.log("%c HUESO SELECCIONADO: " + closestBone.name, "background: #000; color: #0f0; font-weight: bold;");
                    }
                }
            }
        } else {
            console.warn("Click en el vacío (Rayo no tocó el modelo centrado)");
        }
    })
}