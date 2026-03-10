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
    console.log("Raycasting de precisión activado");

    renderer.domElement.addEventListener("pointerdown", (event) => {
        const rect = renderer.domElement.getBoundingClientRect();
        
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouse, camera);

        // Forzamos actualización de matrices
        model.updateMatrixWorld(true);

        // Intersectamos SOLO el modelo
        const intersects = raycaster.intersectObject(model, true);

        if (intersects.length > 0) {
            // Buscamos la malla (SkinnedMesh)
            const hit = intersects.find(i => i.object.isSkinnedMesh || i.object.isMesh);
            
            if (hit && hit.object.isSkinnedMesh) {
                const mesh = hit.object;
                const geometry = mesh.geometry;
                
                // --- TRUCO MAESTRO: Obtener el hueso mediante SkinIndex ---
                // Esto lee directamente qué hueso tiene asignado el vértice que tocaste
                const skinIndex = geometry.attributes.skinIndex;
                if (skinIndex && hit.face) {
                    // Obtenemos el índice del hueso del primer vértice del triángulo tocado
                    const boneIndex = skinIndex.getX(hit.face.a);
                    const detectedBone = mesh.skeleton.bones[boneIndex];

                    if (detectedBone) {
                        console.log("%c HUESO DETECTADO: " + detectedBone.name, "background: #222; color: #bada55; font-size: 1.2em; font-weight: bold;");
                        return; // Salimos para evitar logs extra
                    }
                }
            }
        } else {
            console.warn("Click fuera del modelo");
        }
    });
}