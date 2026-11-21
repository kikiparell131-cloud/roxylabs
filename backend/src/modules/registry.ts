import {Request,Response} from 'express';
export type ApiHandler=(req:Request,res:Response)=>unknown|Promise<unknown>;
export type RegisteredEndpoint={name:string;path:string;method:'GET'|'POST'|'PUT'|'PATCH'|'DELETE';category:string;plan:'Free'|'Premium'|'Both';description:string;handler:ApiHandler};
export const registry:RegisteredEndpoint[]=[
 {name:'Text Encoder',path:'/api/v1/text/encode',method:'POST',category:'Utility',plan:'Free',description:'Encode text into Base64 format.',handler:(req,res)=>{const text=req.body?.text;if(typeof text!=='string')return res.status(400).json({success:false,code:'TEXT_REQUIRED'});return res.json({success:true,creator:'Roxy Main API',result:{encoded:Buffer.from(text,'utf8').toString('base64')}})}},
 {name:'QR Generator',path:'/api/v1/tools/qr',method:'POST',category:'Utility',plan:'Free',description:'Generate QR code data. Provider implementation is not configured.',handler:(_req,res)=>res.status(501).json({success:false,code:'HANDLER_NOT_CONFIGURED'})},
 {name:'Image Enhancer',path:'/api/v1/image/enhance',method:'POST',category:'Image Tools',plan:'Premium',description:'Image enhancement endpoint. Provider implementation is not configured.',handler:(_req,res)=>res.status(501).json({success:false,code:'HANDLER_NOT_CONFIGURED'})}
];
