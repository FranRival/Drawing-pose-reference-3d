const canvas = document.getElementById("scene")

const scene = new THREE.Scene()

scene.background = new THREE.Color(0xffffff)

const camera = new THREE.PerspectiveCamera(
75,
window.innerWidth/window.innerHeight,
0.1,
1000
)

camera.position.z = 5

const renderer = new THREE.WebGLRenderer({
canvas:canvas,
antialias:true
})

renderer.setSize(window.innerWidth-300,window.innerHeight)

const light = new THREE.DirectionalLight(0xffffff,1)
light.position.set(5,5,5)

scene.add(light)

const material = new THREE.MeshStandardMaterial({
color:0xcccccc
})

/* cuerpo */

const body = new THREE.Mesh(
new THREE.CylinderGeometry(0.4,0.4,2),
material
)

scene.add(body)

/* cabeza */

const head = new THREE.Mesh(
new THREE.SphereGeometry(0.35),
material
)

head.position.y = 1.4
scene.add(head)

/* brazo izquierdo */

const armL = new THREE.Mesh(
new THREE.CylinderGeometry(0.15,0.15,1.5),
material
)

armL.position.x = -0.7
armL.position.y = 0.3
armL.rotation.z = 1.5

scene.add(armL)

/* brazo derecho */

const armR = new THREE.Mesh(
new THREE.CylinderGeometry(0.15,0.15,1.5),
material
)

armR.position.x = 0.7
armR.position.y = 0.3
armR.rotation.z = -1.5

scene.add(armR)

/* controles */

document.getElementById("armL").addEventListener("input",(e)=>{

armL.rotation.x = e.target.value

})

document.getElementById("armR").addEventListener("input",(e)=>{

armR.rotation.x = e.target.value

})

/* descarga */

document.getElementById("downloadBtn").addEventListener("click",()=>{

renderer.render(scene,camera)

const link = document.createElement("a")

link.download="pose.png"

link.href = renderer.domElement.toDataURL()

link.click()

})

/* animación */

function animate(){

requestAnimationFrame(animate)

renderer.render(scene,camera)

}

animate()