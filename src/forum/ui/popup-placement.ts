type PopupRect = { left:number; top:number; width:number; height:number };
export function placePopup(anchor: PopupRect, size: {width:number;height:number}, viewport:{left:number;top:number;width:number;height:number}, gap=8) {
 const margin=12, minX=viewport.left+margin, minY=viewport.top+margin;
 const maxX=Math.max(minX,viewport.left+viewport.width-size.width-margin), maxY=Math.max(minY,viewport.top+viewport.height-size.height-margin);
 const below=anchor.top+anchor.height+gap;
 const above=anchor.top-size.height-gap;
 const flip=below+size.height>viewport.top+viewport.height-margin&&above>=minY;
 const left=Math.min(maxX,Math.max(minX,anchor.left));
 const top=Math.min(maxY,Math.max(minY,flip?above:below));
 return {left,top,originX:Math.max(12,Math.min(size.width-12,anchor.left+anchor.width/2-left)),originY:flip?size.height:0};
}
