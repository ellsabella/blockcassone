// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Base64 } from "openzeppelin-contracts/contracts/utils/Base64.sol";
import { Strings } from "openzeppelin-contracts/contracts/utils/Strings.sol";
import { CubeNFT } from "./CubeNFT.sol";
import { ICubeRenderer } from "./interfaces/ICubeRenderer.sol";
import { RendererAssetStore } from "./RendererAssetStore.sol";

interface INormieRawImageStorage {
    function getTokenRawImageData(uint256 tokenId) external view returns (bytes memory);
}

contract CubeRendererV2 is ICubeRenderer {
    using Strings for uint256;

    uint256 public constant HTML_HEAD_CHUNK = 0;
    uint256 public constant HTML_SCRIPT_CHUNK = 1;

    CubeNFT public immutable cubes;
    RendererAssetStore public immutable assets;
    address public immutable normieStorage;

    constructor(CubeNFT cubes_, RendererAssetStore assets_, address normieStorage_) {
        cubes = cubes_;
        assets = assets_;
        normieStorage = normieStorage_;
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        return string.concat(
            "data:application/json;base64,", Base64.encode(bytes(metadataJSON(tokenId)))
        );
    }

    function metadataJSON(uint256 tokenId) public view returns (string memory) {
        CubeNFT.CubeData memory data = cubes.cubeData(tokenId);
        string memory image = imageURI(tokenId);
        return string.concat(
            "{",
            '"name":"Blockcassone Cube #',
            tokenId.toString(),
            '",',
            '"description":"A fully onchain Blockcassone Hilbert cube, rendered from contract-stored source facts and onchain renderer chunks.",',
            '"image":"',
            image,
            '",',
            '"animation_url":"',
            animationURI(tokenId),
            '",',
            '"attributes":[',
            _attributesJSON(data),
            "]}"
        );
    }

    function imageURI(uint256 tokenId) public view returns (string memory) {
        CubeNFT.CubeData memory data = cubes.cubeData(tokenId);
        string memory svg = string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200">',
            '<rect width="1200" height="1200" fill="#020203"/>',
            '<g fill="none" stroke-linecap="round" stroke-linejoin="round">',
            '<path d="M310 325 720 205 960 465 548 598Z" stroke="#ff3ab8" stroke-width="10" opacity=".86"/>',
            '<path d="M310 325v438l238 262V598Z" stroke="#38ff4d" stroke-width="8" opacity=".58"/>',
            '<path d="M548 598v427l412-292V465Z" stroke="#38ff4d" stroke-width="8" opacity=".42"/>',
            '<path d="M402 460h190v210h192v-128h-84v-150h-210v-94" stroke="#ff1919" stroke-width="18" opacity=".95"/>',
            '<path d="M402 460h190v210h192v-128h-84v-150h-210v-94" stroke="#ffffff" stroke-width="4" opacity=".72"/>',
            "</g>",
            '<text x="70" y="1078" fill="#ff98d9" font-family="monospace" font-size="42">cube #',
            tokenId.toString(),
            " / plot ",
            uint256(data.slot).toString(),
            "</text>",
            '<text x="70" y="1132" fill="#aaffb2" font-family="monospace" font-size="28">Normie #',
            data.sourceTokenId.toString(),
            " / region ",
            regionForSlot(data.slot).toString(),
            " / neighbourhood ",
            neighbourhoodForSlot(data.slot).toString(),
            " / street ",
            streetForSlot(data.slot).toString(),
            "</text></svg>"
        );
        return string.concat("data:image/svg+xml;base64,", Base64.encode(bytes(svg)));
    }

    function animationURI(uint256 tokenId) public view returns (string memory) {
        return string.concat("data:text/html;base64,", Base64.encode(bytes(animationHTML(tokenId))));
    }

    function animationHTML(uint256 tokenId) public view returns (string memory) {
        CubeNFT.CubeData memory data = cubes.cubeData(tokenId);
        return string.concat(
            _chunkOrDefault(HTML_HEAD_CHUNK, _defaultHTMLHead()),
            _tokenConfig(tokenId, data),
            _chunkOrDefault(HTML_SCRIPT_CHUNK, _defaultHTMLScript())
        );
    }

    function regionForSlot(uint32 slot) public pure returns (uint256) {
        return uint256(slot) / 512;
    }

    function neighbourhoodForSlot(uint32 slot) public pure returns (uint256) {
        return uint256(slot) / 64;
    }

    function streetForSlot(uint32 slot) public pure returns (uint256) {
        return uint256(slot) / 8;
    }

    function _tokenConfig(uint256 tokenId, CubeNFT.CubeData memory data)
        private
        view
        returns (string memory)
    {
        return string.concat(
            "<script>window.BLOCKCASSONE_TOKEN={",
            "tokenId:",
            tokenId.toString(),
            ",slot:",
            uint256(data.slot).toString(),
            ",sourceKind:",
            uint256(data.sourceKind).toString(),
            ",sourceContract:'",
            Strings.toHexString(uint160(data.sourceContract), 20),
            "',sourceTokenId:",
            data.sourceTokenId.toString(),
            ",normieStorage:'",
            Strings.toHexString(uint160(normieStorage), 20),
            "',agentic:",
            data.agentic ? "true" : "false",
            ",agentId:",
            data.agentId.toString(),
            ",raw:'",
            _rawImageBase64(data),
            "'};</script>"
        );
    }

    function _rawImageBase64(CubeNFT.CubeData memory data) private view returns (string memory) {
        if (data.sourceKind != cubes.SOURCE_KIND_NORMIE() || normieStorage == address(0)) return "";
        try INormieRawImageStorage(normieStorage).getTokenRawImageData(data.sourceTokenId) returns (
            bytes memory raw
        ) {
            return Base64.encode(raw);
        } catch {
            return "";
        }
    }

    function _attributesJSON(CubeNFT.CubeData memory data) private view returns (string memory) {
        return string.concat(
            _trait("plot", uint256(data.slot).toString()),
            ",",
            _trait("region", regionForSlot(data.slot).toString()),
            ",",
            _trait("neighbourhood", neighbourhoodForSlot(data.slot).toString()),
            ",",
            _trait("street", streetForSlot(data.slot).toString()),
            ",",
            _trait(
                "Source Kind",
                data.sourceKind == cubes.SOURCE_KIND_NORMIE() ? "Normie" : "External ERC-721"
            ),
            ",",
            _trait("Source Contract", Strings.toHexString(uint160(data.sourceContract), 20)),
            ",",
            _trait("Source Token ID", data.sourceTokenId.toString()),
            ",",
            _trait("Agentic", data.agentic ? "Y" : "N"),
            ",",
            _trait("Agent ID", data.agentId.toString()),
            ",",
            _trait("Renderer Version", "2"),
            ",",
            _trait("Payload Version", uint256(data.payloadVersion).toString())
        );
    }

    function _trait(string memory traitType, string memory value)
        private
        pure
        returns (string memory)
    {
        return string.concat('{"trait_type":"', traitType, '","value":"', value, '"}');
    }

    function _chunkOrDefault(uint256 chunkId, string memory fallbackContent)
        private
        view
        returns (string memory)
    {
        string memory content = assets.chunk(chunkId);
        return bytes(content).length == 0 ? fallbackContent : content;
    }

    function _defaultHTMLHead() private pure returns (string memory) {
        return
        "<!doctype html><html><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#020203;color:#ff98d9;font:13px monospace}canvas{width:100vw;height:100vh;display:block}.h{position:fixed;left:14px;bottom:12px;padding:9px 11px;border:2px solid #ff3ab8;background:#070208cc;text-shadow:0 0 10px #ff3ab8}</style></head><body><canvas id=c></canvas><div class=h id=h>Blockcassone</div>";
    }

    function _defaultHTMLScript() private pure returns (string memory) {
        return
        "<script>(()=>{const T=window.BLOCKCASSONE_TOKEN,G=40,P=1600,C=document.getElementById('c'),H=document.getElementById('h'),gl=C.getContext('webgl');if(!gl){H.textContent='WebGL unavailable';return}function bytes(b){let s=atob(b||''),o=new Uint8Array(P);for(let i=0;i<P;i++)o[i]=(s.charCodeAt(i>>3)>>(7-(i&7)))&1;return o}let pix=bytes(T.raw),on=pix.reduce((a,b)=>a+b,0),yaw=.8,pit=-.35,dis=3.3,drag=0,lx=0,ly=0;C.onpointerdown=e=>{drag=1;lx=e.clientX;ly=e.clientY;C.setPointerCapture(e.pointerId)};C.onpointerup=e=>{drag=0;C.releasePointerCapture(e.pointerId)};C.onpointermove=e=>{if(!drag)return;yaw+=(e.clientX-lx)*.007;pit=Math.max(-1.3,Math.min(1.3,pit+(e.clientY-ly)*.006));lx=e.clientX;ly=e.clientY};C.onwheel=e=>{e.preventDefault();dis=Math.max(1.7,Math.min(7,dis*Math.exp(e.deltaY*.0012)))};let vs='attribute vec3 p,c;uniform mat4 m;varying vec3 v;void main(){v=c;gl_Position=m*vec4(p,1.);gl_PointSize=4.;}',fs='precision mediump float;varying vec3 v;void main(){gl_FragColor=vec4(v,1.);}';function sh(t,s){let x=gl.createShader(t);gl.shaderSource(x,s);gl.compileShader(x);return x}let pr=gl.createProgram();gl.attachShader(pr,sh(gl.VERTEX_SHADER,vs));gl.attachShader(pr,sh(gl.FRAGMENT_SHADER,fs));gl.linkProgram(pr);let a=[],v=(p,c)=>a.push(p[0],p[1],p[2],c[0],c[1],c[2]),sg=(a0,b,c)=>{v(a0,c);v(b,c)},cell=x=>x/G*2-1,get=(r,c)=>r<0||r>=G||c<0||c>=G?0:pix[r*G+c];for(let r=0;r<G;r++)for(let c=0;c<G;c++)if(get(r,c)){let x=cell(c+.5),y=-cell(r+.5),z=1;if(!get(r-1,c))sg([cell(c),-cell(r),z],[cell(c+1),-cell(r),z],[1.4,.02,.05]);if(!get(r+1,c))sg([cell(c),-cell(r+1),z],[cell(c+1),-cell(r+1),z],[1.4,.02,.05]);if(!get(r,c-1))sg([cell(c),-cell(r),z],[cell(c),-cell(r+1),z],[1.4,.02,.05]);if(!get(r,c+1))sg([cell(c+1),-cell(r),z],[cell(c+1),-cell(r+1),z],[1.4,.02,.05]);v([x,y,.4],[.2,1.2,.2])}let s=1.02,ed=[[-s,-s,-s],[s,-s,-s],[s,s,-s],[-s,s,-s],[-s,-s,s],[s,-s,s],[s,s,s],[-s,s,s]],ei=[[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];ei.forEach(e=>sg(ed[e[0]],ed[e[1]],[1,.1,.7]));let buf=gl.createBuffer(),arr=new Float32Array(a);gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.bufferData(gl.ARRAY_BUFFER,arr,gl.STATIC_DRAW);function mat(){return new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1])}function frame(){let d=Math.min(2,devicePixelRatio||1),w=C.clientWidth*d,h=C.clientHeight*d;if(C.width!=w||C.height!=h){C.width=w;C.height=h}gl.viewport(0,0,C.width,C.height);gl.clearColor(.006,.006,.008,1);gl.clear(gl.COLOR_BUFFER_BIT);gl.useProgram(pr);let m=mat();m[0]=Math.cos(yaw)/1.5;m[2]=Math.sin(yaw)/1.5;m[5]=Math.cos(pit)/1.5;m[10]=1/dis;gl.uniformMatrix4fv(gl.getUniformLocation(pr,'m'),0,m);gl.bindBuffer(gl.ARRAY_BUFFER,buf);let P0=gl.getAttribLocation(pr,'p'),C0=gl.getAttribLocation(pr,'c');gl.enableVertexAttribArray(P0);gl.enableVertexAttribArray(C0);gl.vertexAttribPointer(P0,3,gl.FLOAT,0,24,0);gl.vertexAttribPointer(C0,3,gl.FLOAT,0,24,12);gl.drawArrays(gl.LINES,0,arr.length/6);H.textContent='Cube #'+T.tokenId+' / Normie #'+T.sourceTokenId+' / plot '+T.slot+' / '+on+' lit pixels';requestAnimationFrame(frame)}frame()})();</script></body></html>";
    }
}
