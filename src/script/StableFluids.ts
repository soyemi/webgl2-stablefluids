import { GLSL_VS_DEFAULT, GLSL_PS_ADVECT, GLSL_PS_FORCE, GLSL_PS_JACOBI1D, GLSL_PS_JACOBI2D, GLSL_PS_PROJSETUP, GLSL_PS_PROJFINISH, GLSL_PS_DEFAULT, GLSL_PS_COLOR } from "./ShaderLibs";


const SIM_SIZE_W: number = 512;
const SIM_SIZE_H: number = 512;

export class StableFluids {

    private gl: WebGL2RenderingContext;

    private m_frameBuffer: WebGLFramebuffer;

    private m_bufferVertexQuad: WebGLBuffer;
    private m_bufferIndicesQuad: WebGLBuffer;

    private m_vaoQuad: WebGLVertexArrayObject;

    private m_programAdvect: ShaderProgram;
    private m_programForce: ShaderProgram;
    private m_programProjSetup: ShaderProgram;
    private m_programProjFinish: ShaderProgram;
    private m_programJacobi1D: ShaderProgram;
    private m_programJacobi2D: ShaderProgram;
    private m_programColor: ShaderProgram;
    private m_programDefault: ShaderProgram;

    private m_texImage: WebGLTexture;

    private m_inited: boolean = false;
    private m_textureLoaded: boolean = false;
    private m_lastTimestamp: number = 0;

    private m_mouseX: number = 0;
    private m_mouseY: number = 0;

    private m_mouseMoved:boolean = false;


    public constructor(canvas: HTMLCanvasElement) {

        this.gl = canvas.getContext('webgl2');
        if (this.gl == null) {
            throw new Error("webgl2 not supported!");
            return;
        }

        canvas.addEventListener('mousemove', this.EvtOnMouseMove, false);


        this.InitGL();
    }

    private EvtOnMouseMove(e: MouseEvent) {
        this.m_mouseX = e.offsetX;
        this.m_mouseY = e.offsetY;
    }

    private InitGL() {
        let gl = this.gl;

        //exts
        let avail_exts = gl.getSupportedExtensions();
        let ext = gl.getExtension('EXT_color_buffer_float');
        let extf = gl.getExtension('OES_texture_float_linear');

        //buffers
        let vbuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vbuffer);
        var vdata: number[] = [];
        vdata.push(0, 0);
        vdata.push(0, 1.0);
        vdata.push(1.0, 1.0);
        vdata.push(1.0, 0);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vdata), gl.STATIC_DRAW);
        this.m_bufferVertexQuad = vbuffer;

        let ibuffer: WebGLBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibuffer);
        let idata: number[] = [0, 1, 2, 0, 2, 3];
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idata), gl.STATIC_DRAW);
        this.m_bufferIndicesQuad = ibuffer;

        //shader programs
        this.m_programColor = ShaderProgram.LoadShader(gl, GLSL_VS_DEFAULT, GLSL_PS_COLOR);
        this.m_programDefault = ShaderProgram.LoadShader(gl, GLSL_VS_DEFAULT, GLSL_PS_DEFAULT);

        this.m_programAdvect = ShaderProgram.LoadShader(gl, GLSL_VS_DEFAULT, GLSL_PS_ADVECT);
        this.m_programForce = ShaderProgram.LoadShader(gl, GLSL_VS_DEFAULT, GLSL_PS_FORCE);
        this.m_programJacobi1D = ShaderProgram.LoadShader(gl, GLSL_VS_DEFAULT, GLSL_PS_JACOBI1D);
        this.m_programJacobi2D = ShaderProgram.LoadShader(gl, GLSL_VS_DEFAULT, GLSL_PS_JACOBI2D);
        this.m_programProjSetup = ShaderProgram.LoadShader(gl, GLSL_VS_DEFAULT, GLSL_PS_PROJSETUP);
        this.m_programProjFinish = ShaderProgram.LoadShader(gl, GLSL_VS_DEFAULT, GLSL_PS_PROJFINISH);


        //vao
        let vao = gl.createVertexArray();
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.m_bufferVertexQuad);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.m_bufferIndicesQuad);

        gl.enableVertexAttribArray(this.m_programColor.AttrPosition);
        gl.vertexAttribPointer(this.m_programColor.AttrPosition, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(this.m_programColor.AttrUV);
        gl.vertexAttribPointer(this.m_programColor.AttrUV, 2, gl.FLOAT, false, 0, 0);

        gl.bindVertexArray(null);
        this.m_vaoQuad = vao;

        //image
        this.m_texImage = this.LoadImage('image.png',()=>this.m_textureLoaded = true);

        //framebuffer
        let fbuffer: WebGLFramebuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbuffer);
        this.m_frameBuffer = fbuffer;

        gl.viewport(0, 0, SIM_SIZE_W, SIM_SIZE_H);
        gl.clearColor(0, 0, 0, 1);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    }


    private m_texV1: WebGLTexture;
    private m_texV2: WebGLTexture;
    private m_texV3: WebGLTexture;
    private m_texP1: WebGLTexture;
    private m_texP2: WebGLTexture;

    private m_colRT1 :WebGLTexture;
    private m_colRT2: WebGLTexture;

    private m_dx: number;
    private m_difAlpha_prec:number;
    private m_viscosity:number = 0.002478;
    private m_force:number = 300;
    private m_exponent:number = 200;


    private InitSimulator() {
        if(!this.m_textureLoaded) return;

        let gl = this.gl;
        this.m_texV1 = this.CreateTexture(gl.RG32F,SIM_SIZE_W,SIM_SIZE_H);
        this.m_texV2 = this.CreateTexture(gl.RG32F,SIM_SIZE_W,SIM_SIZE_H);
        this.m_texV3 = this.CreateTexture(gl.RG32F,SIM_SIZE_W,SIM_SIZE_H);

        this.m_texP1 = this.CreateTexture(gl.R32F,SIM_SIZE_W,SIM_SIZE_H);
        this.m_texP2 = this.CreateTexture(gl.R32F,SIM_SIZE_W,SIM_SIZE_H);
        
        this.m_colRT1 = this.CreateTexture(gl.RGBA4,SIM_SIZE_W,SIM_SIZE_H);
        this.m_colRT2 = this.CreateTexture(gl.RGBA4,SIM_SIZE_W,SIM_SIZE_H);

        this.RenderToTexture(this.m_texImage,this.m_texV1);
        this.ResetFrameBuffer();

        this.m_inited = true;

        let dx = 1.0/ SIM_SIZE_H;
        this.m_dx = dx;
        this.m_difAlpha_prec = dx * dx / this.m_viscosity;
    }

    public onFrame(ts: number) {
        if (!this.m_inited){
            this.InitSimulator();
            return;
        }
        if (this.m_lastTimestamp == 0.0) {
            this.m_lastTimestamp = ts;
            return;
        }
        let deltaTime = (ts - this.m_lastTimestamp)/1000.0;
        this.m_lastTimestamp = ts;

        var gl = this.gl;

        //gl.clearColor(1,0,0,1);
        //this.Clear();

        //this.DrawTexture(this.m_colRT1,null,null,this.m_programDefault,null);

        //Do simulation

        //Advection
        this.SetRenderTarget(this.m_texV2);
        this.DrawTexture(this.m_texV1,null,null,this.m_programAdvect,(p)=>{
            let wgl = gl;
            gl.uniform1f(p.UnifDeltaTime,deltaTime);
        });

        //Diffuse setup
        let dif_alpha = this.m_difAlpha_prec / deltaTime;
        let alpha = dif_alpha;
        let beta = alpha + 4;

        //copy v2 to v1
        this.RenderToTexture(this.m_texV2,this.m_texV1);

        for(let i=0;i<1;i++){
            this.SetRenderTarget(this.m_texV3);
            this.DrawTexture(this.m_texV2,this.m_texV1,null,this.m_programJacobi2D,(p)=>{
                let wgl = gl;
                wgl.uniform1f(p.UnifAlpha,alpha);
                wgl.uniform1f(p.UnifBeta,beta);
            })

            this.SetRenderTarget(this.m_texV2);
            this.DrawTexture(this.m_texV3,this.m_texV1,null,this.m_programJacobi2D,(p)=>{
                let wgl = gl;
                wgl.uniform1f(p.UnifAlpha,alpha);
                wgl.uniform1f(p.UnifBeta,beta);
            })
        }

        this.ResetFrameBuffer();
        this.DrawTextureDefault(this.m_texV2);
        
    }


    private Clear(){
        let gl = this.gl;
        gl.clear(gl.COLOR_BUFFER_BIT);
    }

    private ResetFrameBuffer(){
        let gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    }

    private SetRenderTarget(texture: WebGLTexture) {
        let gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.m_frameBuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    }

    private RenderToTexture(src:WebGLTexture,dest:WebGLTexture){
        if(src === dest){
            console.error('can not render to the same texture');
            return;
        }

        this.SetRenderTarget(dest);
        this.DrawTexture(src,null,null,this.m_programDefault,null);
    }

    private DrawTextureDefault(tex0:WebGLTexture){
        this.DrawTexture(tex0,null,null,this.m_programDefault,null);
    }

    private DrawTexture(tex0:WebGLTexture,tex1?:WebGLTexture,tex2?:WebGLTexture,program?:ShaderProgram,setUniform?:(p:ShaderProgram)=>void){
        if(program == null) program = this.m_programDefault;

        let gl = this.gl;
        gl.bindVertexArray(this.m_vaoQuad);
        gl.useProgram(program.Program);

        if(tex0 != null){
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D,tex0);
            gl.uniform1i(program.UnifSampler0,0);
        }
        if(tex1 != null){
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D,tex1);
            gl.uniform1i(program.UnifSampler1,1);
        }
        if(tex2 != null){
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D,tex2);
            gl.uniform1i(program.UnifSampler2,2);
        }

        if(setUniform != null){
            setUniform(program);
        }
        gl.drawElements(gl.TRIANGLES,6,gl.UNSIGNED_SHORT,0);

        
    }

    private CreateTexture(internalFormat: number, width: number, height: number): WebGLTexture {
        let gl = this.gl;

        let tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texStorage2D(gl.TEXTURE_2D,1,internalFormat,width,height);
        gl.generateMipmap(gl.TEXTURE_2D);

        return tex;
    }

    private LoadImage(src: string,callback?:()=>void): WebGLTexture {
        var img = new Image();
        var gl = this.gl;
        var tex = gl.createTexture();
        img.onload = () => {
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
            gl.generateMipmap(gl.TEXTURE_2D);

            gl.bindTexture(gl.TEXTURE_2D,null);

            console.log('init webgl texture');
            if(callback!= null) callback();
        };
        img.src = src;
        return tex;
    }


}

class ShaderProgram {

    public Program: WebGLProgram;

    public Attributes: { [key: string]: number } = {};
    public Unifroms: { [key: string]: WebGLUniformLocation } = {};

    public AttrPosition: number;
    public AttrUV: number;

    public UnifColor: WebGLUniformLocation;
    public UnifSampler0: WebGLUniformLocation;
    public UnifSampler1: WebGLUniformLocation;
    public UnifSampler2: WebGLUniformLocation;

    public UnifDeltaTime: WebGLUniformLocation;

    //Jacobi2
    public UnifAlpha: WebGLUniformLocation;
    public UnifBeta:WebGLUniformLocation;

    private constructor(gl: WebGL2RenderingContext, program: WebGLProgram) {
        this.Program = program;

        const numAttrs = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
        for (let i = 0; i < numAttrs; i++) {
            const attrInfo = gl.getActiveAttrib(program, i);
            if (attrInfo == null) continue;
            const attrLoca = gl.getAttribLocation(program, attrInfo.name);
            this.Attributes[attrInfo.name] = attrLoca;
        }

        const numUniform = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < numUniform; i++) {
            const uniformInfo = gl.getActiveUniform(program, i);
            if (uniformInfo == null) continue;
            const uniformLoca = gl.getUniformLocation(program, uniformInfo.name);
            this.Unifroms[uniformInfo.name] = uniformLoca;
        }

        this.AttrPosition = this.Attributes['aPosition'];
        this.AttrUV = this.Attributes['aUV'];

        this.UnifColor = this.Unifroms['uColor'];
        this.UnifSampler0 = this.Unifroms['uSampler'];
        this.UnifSampler1 = this.Unifroms['uSampler1'];
        this.UnifSampler2 = this.Unifroms['uSampler2'];

        this.UnifDeltaTime = this.Unifroms['uDeltaTime'];

        this.UnifAlpha = this.Unifroms['uAlpha'];
        this.UnifBeta = this.Unifroms['uBeta'];
    }

    public static LoadShader(gl: WebGL2RenderingContext, vsource: string, psource: string) {

        let vs = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vs, vsource);
        gl.compileShader(vs);

        if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
            console.error('compile vertex shader failed: ' + gl.getShaderInfoLog(vs));
            gl.deleteShader(vs);
            return null;
        }

        let ps = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(ps, psource);
        gl.compileShader(ps);

        if (!gl.getShaderParameter(ps, gl.COMPILE_STATUS)) {
            console.error('compile fragment shader failed: ' + gl.getShaderInfoLog(ps));
            gl.deleteShader(ps);
            return null;
        }

        let program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, ps);
        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error('link shader program failed!:' + gl.getProgramInfoLog(program));
            gl.deleteProgram(program);
            gl.deleteShader(vs);
            gl.deleteShader(ps);
            return null;
        }

        return new ShaderProgram(gl, program);
    }
}