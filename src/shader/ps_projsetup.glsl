#version 300 es
precision mediump float;
in vec2 vUV;

uniform sampler2D uSampler; //2D
uniform float uDeltaTime;

out float fragColor;
void main(){
    ivec2 texsize = textureSize(uSampler,0);
    float uoff = 1.0/ float(texsize.x);
    float voff = 1.0 / float(texsize.y);


    float x1 = texture(uSampler,vUV + vec2(uoff,0)).x;
    float x2 = texture(uSampler,vUV - vec2(uoff,0)).x;

    float y1 = texture(uSampler,vUV+ vec2(0,voff)).y;
    float y2 = texture(uSampler,vUV - vec2(0,voff)).y;

    fragColor = (x1 - x2 + y1 - y2) / 2.0;
}