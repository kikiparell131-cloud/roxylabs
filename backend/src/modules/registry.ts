import {Request,Response} from 'express';
export type ApiHandler=(req:Request,res:Response)=>unknown|Promise<unknown>;
export type RegisteredEndpoint={name:string;path:string;method:'GET'|'POST'|'PUT'|'PATCH'|'DELETE';category:string;plan:'Free'|'Premium'|'Both';description:string;handler:ApiHandler;moduleFile?:string};
// Intentionally empty: endpoints only appear after an owner registers a real backend/api/*.js module.
export const registry:RegisteredEndpoint[]=[];
