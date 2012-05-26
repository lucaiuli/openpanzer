/**
 * Render - draws the graphic elements on canvases
 *
 * http://www.linuxconsulting.ro
 * http://openpanzer.net
 *
 * Copyright (c) 2012 Nicu Pavel
 * Licensed under the GPL license:
 * http://www.gnu.org/licenses/gpl.html
 */

function Render(mapObj)
{
	var map = mapObj;
	
	var imgUnits = {};
	var imgCursor;
	var imgFlags;
	var imgMapBackground;
	
	var lastCursorCell = null; //Last cell for which the cursor was built
	var lastCursorImage = null;//last cursor image
	var lastCursorUnit = null; //last unit for which a cursor was generated
	
	var ch; // The hexes canvas element
	var cm; // The map canvas element
	var ca; // The animation canvas element.Also used as cursor coords but c canvas can be used as well
	var cbb; //A backbuffer canvas for dynamically creating images (as in cursor image)
	var c = null; //This is the context where the main drawing takes place
	var cb = null;//This is the context where the map image is drawn. Can be made a background of the main drawing
	var a = null; //This is where the animations(explosions/fire/etc) are drawn. Also used as cursor coords but c canvas can be used as well
	var bb = null; //Backbuffer context
	
	//Hex sizes compatible with PG2 sizes
	var s = 30;  //hexagon segment size                    |\  
	var h = s/2; //hexagon height h = sin(30)*s           r| \ s
	var r = 25;  //hexagon radius r = cos(30)*s ~ s*0.833  -h-

	// Canvas offset from the browser window (leaves space for top menu)
	var canvasOffsetX = 0;
	var canvasOffsetY = 30;
	// Where to start rendering respective to the canvas
	// Since PG2 maps define even the half and "quarter" hexes that form at the edges we need to offset those
	var renderOffsetX = - (s + h);
	var renderOffsetY = - r;
	
	//we slice the screen in columns of s + h size
	var colSlice = s + h; 
	//add an offset for better rounding of mouse position in a column
	var mousePrecisionOffset = s/100;
	//Unit strength text size (px)
	var unitTextHeight = 10;	
	//Animation Chain
	var animationChain = new AnimationChain();
	//The rendering style
	var styles = new RenderStyle();
	//Render Settings from UI
	var uiSettings = null;
		
	createLayers(); //Creates canvas layers
				
	this.render = function()
	{
		var x0;
		var y0;
		var style;
		var hex;
		var current = null;
		var unit = null;
		
		if (map.currentUnit !== null)
			current = map.currentUnit.getPos();
		
		styles.setHexGrid(uiSettings.hexGrid);
		
		c.clearRect(0, 0, c.canvas.width, c.canvas.height);
		a.clearRect(0, 0, a.canvas.width, a.canvas.height);
		for (row = 0; row < map.rows; row++) 
		{
			//we space the hexagons on each line next column being on the row below 
			for (col = 0; col < map.cols; col++) 
			{
				hex = map.map[row][col];
				style = styles.generic;
				//flat-out hex layout //inline for performance gain
				if (col & 1) // odd column
				{
					y0 =  row * 2 * r + r + renderOffsetY;
					x0 =  col * (s + h) + h + renderOffsetX;
				}
				else
				{
					y0 = row * 2 * r  + renderOffsetY;
					x0 = col * (s + h) + h + renderOffsetX;
				}
				if (uiSettings.mapZoom) 
				{
					drawHexZoomDecals(x0, y0, hex); 
					continue;  
				}
				if (hex.isMoveSel) 
					style = styles.selected;
				if (hex.isAttackSel) 
					style = styles.attack;
				if ((current !== null) && (typeof current !== "undefined") 
					&& (row == current.row) && (col == current.col)) 
					style = styles.current;
					
				drawHexDecals(x0, y0, hex);
				drawHexGrid(x0, y0, style);
				
				//Don't render unit if it has a move animation or it's not spotted
				unit = hex.getUnit(!uiSettings.airMode);
				if (hex.isSpotted(map.currentSide) && unit !== null && !unit.hasAnimation)
					drawHexUnit(c, x0, y0, unit, false); //Unit below depending on airMode

				unit = hex.getUnit(uiSettings.airMode);
				if (hex.isSpotted(map.currentSide) && unit !== null && !unit.hasAnimation)
					drawHexUnit(c, x0, y0, unit, true); //Unit above with strength box drawn
			}
		}
	}
		
	//Renders attack or transport move cursor 
	this.drawCursor = function(cell)
	{
		var row = cell.row;
		var col = cell.col;
		var hex = map.map[row][col];
		var curw = bb.canvas.width; //cursor width
		var curh = bb.canvas.height; //cursor height
		
		var redraw = false;
		
		if (lastCursorUnit !== map.currentUnit)
			redraw = true; //Redraw because a new unit has been selected

		//TODO Check if we should generate an TRANSPORT Cursor
		
		//Check if we should generate an ATTACK cursor
		if (hex.isAttackSel && map.currentUnit !== null &&  !map.currentUnit.hasFired)
		{	
			//check cell if a cursor should be generated again	
			if ((redraw == true) || (lastCursorCell === null) || (lastCursorImage === null) ||
				(lastCursorCell.row != row) || (lastCursorCell.col != col))
			{ 
				//TODO check unit mounted/unmounted 
				redraw = true; //Force css cursor assignment
				var atkunit = map.currentUnit;
				var defunit = hex.getAttackableUnit(atkunit, uiSettings.airMode);
				var atkflag = atkunit.player.country;
				var defflag = defunit.player.country;
				var cr = GameRules.calculateAttackResults(map.map, atkunit, defunit);
				lastCursorUnit = atkunit;
				lastCursorCell = cell;
				lastCursorImage = generateAttackCursor(cr.kills, cr.losses, atkflag, defflag);
			}
			//only assign a new css cursor if needed (to reduce html element load)
			if ((ca.style.cursor == 'default') || (ca.style.cursor == 'pointer')
				|| (ca.style.cursor == 'auto') || (redraw == true))
			{
				//cursor data, hotspot x, hotspot y, fallback cursor image
				ca.style.cursor = "url('" + lastCursorImage + "') " + curw/2 + " " + curh/2 +", auto";
			}
		}
		else
		{
			//TODO PG2 default cursor
			ca.style.cursor = 'default';
		}
	}
	
	//Runs all animations in order that they were added and then delete all animations
	this.runAnimation = function()
	{
		animationChain.start();
	}
	
	//Adds an animation to the list
	this.addAnimation = function(row, col, animationName, facing)
	{
		if (! (animationName in animationsData))
			return false;
		
		if (typeof facing === "undefined")
			facing = direction.N;
			
		var anim = animationsData[animationName];
		var pos = cellToScreen(row, col);
		var y0 = parseInt(pos.y - anim.image.height/2 + r);
		var x0 = parseInt(pos.x - anim.width/2 + s/2);

		animationChain.add({
			ctx:a, 
			x:x0, 
			y:y0, 
			width:anim.width, 
			height:anim.image.height,  
			frames:anim.frames - 1, //index from 0 
			image: anim.image,
			rotate: directionToRadians[facing]
		});
		
		return true;
	}
	
	//TODO stop another running animation 
	this.moveAnimation = function(unit, cellList)
	{
		if (unit === null) return;
		var ma = new MoveAnimation(unit, cellList);
		ma.movTimer = setInterval( function() { ma.start();}, 30);
	}
	
	//Animates the unit moving thru a list of cells
	function MoveAnimation (unit, cellList)
	{
		var animSteps = 5;
		var movIndex = 0;
		var movStep = 0;
		
		unit.hasAnimation = true; //signal render that unit is going to be move animated
		this.movTimer = null;
		
		this.start = function()
		{
			if (movIndex >= cellList.length - 1)
			{
				movStep = 0;
				movIndex = 0;
				clearInterval(this.movTimer);
				unit.hasAnimation = false;
				//console.log("Stopping animation for unit id:" + unit.id);
				return;
			}
		
			if (movStep == 0)
			{
				cCell = cellList[movIndex];
				dCell = cellList[movIndex + 1];
			
				cPos = cellToScreen(cCell.row, cCell.col);
				dPos = cellToScreen(dCell.row, dCell.col);
				
				xstep = parseInt((dPos.x - cPos.x)/animSteps);
				ystep = parseInt((dPos.y - cPos.y)/animSteps);
				
				actualFacing = GameRules.getDirection(cCell.row, cCell.col, dCell.row, dCell.col); 
			
				if (Math.abs(actualFacing - unit.facing) > 1) 
					unit.facing = actualFacing;
			}

			a.clearRect(cPos.x - 20, cPos.y - 20, 80, 70); //hex size + 20
			cPos.x += xstep;
			cPos.y += ystep;
			drawHexUnit(a, cPos.x, cPos.y, unit, false);
			movStep++;
			
			if (movStep >= animSteps) 
			{
				movIndex++;
				movStep = 0;
			}
		}
	}
		
	//Converts from screen x,y to row,col in map array
	this.screenToCell = function(x, y)
	{
		var vrow; //virtual graphical rows
		var trow, tcol; //true map rows/cols

		tcol = Math.round((x - renderOffsetX) / colSlice + mousePrecisionOffset) - 1; 		
		//a graphical row (half hex) not the array row
		vrow = (y - renderOffsetY * (~tcol & 1)) / r; //Half hexes add r if col is odd
		//shift to correct row index	
		trow = Math.round(vrow/2 - 1 * (vrow & 1));
		if (trow < 0) { trow = 0; }
		
		//console.log("Hex is at [" +  trow + "][" + tcol + "] Virtual [" + vrow + "][" + tcol + "]");
		return new Cell(trow, tcol);
	}
	
	//Returns the top corner position in screen coordinates 
	function cellToScreen(row, col)
	{
		if (col & 1) // odd column
		{
			y0 =  row * 2 * r + r + renderOffsetY;
			x0 =  col * (s + h) + h + renderOffsetX;
		}
		else
		{
			y0 = row * 2 * r  + renderOffsetY;
			x0 = col * (s + h) + h + renderOffsetX;
		}
		
		return new screenPos(x0, y0);
	}
	
	//Caches images, func a function to call upon cache completion
	this.cacheImages = function(func)
	{
		imgCursor = new Image();
		imgCursor.src = "resources/ui/cursors/attack.png";
		
		imgFlags = new Image();
		imgFlags.src = "resources/ui/flags/flags_med.png";
		
		imgMapBackground = new Image();
		imgMapBackground.src = map.terrainImage;
		imgMapBackground.onload = function() { setupLayers(); func(); }
		
		cacheUnitImages(map.getUnitImagesList(), func);
	}
	
	//Returns canvases 
	this.getHexesCanvas = function() { return ch; }
	this.getMapCanvas = function() { return cm; }
	this.getCursorCanvas = function() { return ca; }
	//Sets the local uiSettings to UI uiSettings
	this.setUISettings = function(obj) { uiSettings = obj; }
	//Sets a new map for rendering. Only used to dinamically change the map being rendered
	this.setNewMap = function(mapObj) { map = mapObj; }
	
		
	// "Private"
	function createLayers()
	{
		//Check if the canvases already exists in the curent document to prevent 
		//overlaying multiple rendering instances
		//Map image as background
		if ((cm = $('map')) === null) cm = document.createElement('canvas');
		cm.id = "map";
		cm.style.cssText = 'z-index: 0;position:absolute;left:' + canvasOffsetX +'px;top:'+ canvasOffsetY + 'px;';
		document.getElementById("game").appendChild(cm);
		// Hexes/units/flags
		if ((ch = $('hexes')) === null) ch = document.createElement('canvas');
		ch.id = "hexes";
		ch.style.cssText = 'z-index: 1;position:absolute;left:' + canvasOffsetX + 'px;top:'+ canvasOffsetY + 'px;';
		document.getElementById("game").appendChild(ch);
		// Animation and cursors
		if ((ca = $('cursor')) === null) ca = document.createElement('canvas');
		ca.id = "cursor";
		ca.style.cssText = 'z-index: 2;position:absolute;left:' + canvasOffsetX +'px;top:'+ canvasOffsetY + 'px;';
		document.getElementById("game").appendChild(ca);
		// Backbuffer
		cbb = document.createElement('canvas');
		cbb.id = "backbuffer";
		
		cb = cm.getContext('2d');
		c = ch.getContext('2d');
		a = ca.getContext('2d');
		bb = cbb.getContext('2d');
	}
	
	//Draws map background image and sets canvases dimesions and position on screen
	function setupLayers()
	{
		c.canvas.width = cb.canvas.width = a.canvas.width = imgMapBackground.width;
		c.canvas.height = cb.canvas.height = a.canvas.height = imgMapBackground.height;
		
		bb.canvas.width = bb.canvas.height = 54; //Currently the size of the attack cursor
		
		cb.drawImage(imgMapBackground, 0, 0);
		canvasOffsetX = window.innerWidth/2 - imgMapBackground.width/2;
		if (canvasOffsetX < 0) { canvasOffsetX = 0;}
					
		// Center the canvases
		cm.style.cssText = 'z-index: 0;position:absolute;left:' + canvasOffsetX +'px;top:'+ canvasOffsetY + 'px;';
		ch.style.cssText = 'z-index: 1;position:absolute;left:' + canvasOffsetX +'px;top:'+ canvasOffsetY + 'px;';
		ca.style.cssText = 'z-index: 1;position:absolute;left:' + canvasOffsetX +'px;top:'+ canvasOffsetY + 'px;';
	}
	
	//Generates an attack cursor on backbuffer canvas
	function generateAttackCursor(kills, losses, atkflag, defflag)
	{
		var flw = 21; //one flag width
		var flh = 14; //flag height
		var bbw = bb.canvas.width;
		var bbh = bb.canvas.height;

		bb.clearRect(0, 0, bbw, bbh);
		bb.drawImage(imgCursor, bbw/2 - imgCursor.width/2, bbh/2 - imgCursor.height/2);
		bb.drawImage(imgFlags, flw*atkflag, 0, flw, flh, 0, 0, flw, flh)
		bb.drawImage(imgFlags, flw*defflag, 0, flw, flh, bbw - flw, 0, flw, flh);
		
		//estimated losses and kills
		bb.font = "12px monospace";
		bb.fillStyle = "yellow";
		bb.textBaseline = "top";
		
		var tx = flw/2 - bb.measureText(losses).width/2;
		var ty = flh;
		bb.strokeText(losses, tx+1, ty+1);
		bb.fillText(losses, tx, ty);
		tx = bbw - flw/2 - bb.measureText(kills).width/2;
		bb.strokeText(kills, tx+1, ty+1);
		bb.fillText(kills, tx, ty);
		
		return cbb.toDataURL(); //return canvas pixels encoded to base64
	}
	
	//imgList a list of image file names, func a function to call upon cache completion
	//Units are saved from Luiz Guzman SHPTool to a 1x9 sprites bmp and 
	//converted to transparent png by convert.py
	function cacheUnitImages(imgList, func)
	{
		var loaded = 0;
		var toLoad = Object.keys(imgList).length; //Size of the "hash"

		for (i in imgList)
		{
			if (typeof imgUnits[imgList[i]] !== "undefined" )
			{
				//console.log("Already loaded");
				loaded++;
				continue;
			}
			
			imgUnits[imgList[i]] = new Image();
			imgUnits[imgList[i]].onload = function() 
			{
				loaded++;  
				if (loaded == toLoad)
					func();
			}
			imgUnits[imgList[i]].src = imgList[i];
		}	
	}
	
	function drawHexDecals(x0, y0, hex)
	{
		if (hex.flag != -1) 
		{ 
			var flw = 21; //one flag width
			var flh = 14; //flag height
			var tx = x0 +  s/2 - flw/2;
			var ty = y0 + 2 * r - flh - 2;
			
			c.drawImage(imgFlags, flw * hex.flag, 0, flw, flh, tx, ty, flw, flh);
			
			if (hex.victorySide != -1)
			{
				c.beginPath();
				c.lineWidth = 2;
				c.strokeStyle = "rgba(139,0,0,1)";
				c.strokeRect  (tx-1, ty-1, flw+2, flh+2);
				c.strokeStyle = "rgba(127,255,0,1)";
				c.strokeRect  (tx-3, ty-3, flw+6, flh+6);
				c.strokeStyle = "rgba(0,0,0,1)";
				c.lineWidth = 1;
				c.strokeRect  (tx-4, ty-4, flw+8, flh+8);
				c.closePath();
			}
		}
		//TODO draw bridge/blown bridges decals
	}
	
	function drawHexZoomDecals(x0, y0, hex)
	{
		var flw = 21; //one flag width
		var flh = 14; //flag height
		
		var tx = x0 +  s/2 - flw/2;
		var ty = y0 +  r - flh - 2;
		
		var flag = -1;
		var scale = 0;
		var unit = null;
		
		c.save();
		//Only renders flag for air or ground units not both
		if (uiSettings.airMode)
			unit = hex.airunit;
		else
			unit = hex.unit;
			
		if (unit !== null)
		{
			flag = unit.player.country;
			scale = 1.4;
			if (unit.hasMoved)
				c.globalAlpha = 0.6;
		}
		if (hex.flag != -1 && hex.victorySide != -1) 
		{ 
			flag = hex.flag;
			scale = 3;
		}
		if (flag == -1) return;
		
		c.drawImage(imgFlags, flw * flag, 0, flw, flh, tx, ty, scale*s, scale*s/(flw/flh));
		c.restore();
	}
	
	function drawHexUnit(c, x0, y0, unit, drawIndicators)
	{
		if (unit === null)
			return;

		image = imgUnits[unit.getIcon()];
		if (image) 
		{
			// Units have 15 possible orientations there are 9 sprites each ~80x50 in 1 row
			// to get the rest of the orientations the sprite must be mirrored
			var mirror = false;
			var imagew = image.width/9; //Some images have bigger width
			var imageh = image.height;
			//Offset the transparent regions of the unit sprite
			var ix0 = parseInt(x0 - imagew/2 + s/2);
			var iy0 = parseInt(y0 - imageh/2 + r - unitTextHeight);
			facing = unit.facing;
			if (facing > 8)
			{
				facing = 16 - facing; 
				mirror = true;
			}
			var imgidx = imagew * facing;
			if (mirror)
			{
				var flip = ix0 + imagew/2;
				c.save();
				c.translate(flip, 0);
				c.scale(-1,1);
				c.translate(-flip,0);
			}
			c.drawImage(image, imgidx , 0, imagew, imageh, ix0, iy0, imagew, imageh);
			if (mirror) c.restore();
		}

		if (!drawIndicators) return;
		
		//Write unit strength in a box below unit
		c.font = unitTextHeight + "px sans-serif";
		var text = "" + unit.strength;
		var textcolor = "black"
		var textSize = c.measureText(text).width;
		var tx = parseInt(x0 + h/2);
		var ty = y0 + 2 * r - (unitTextHeight + 2); //text size + spacing
		
		var side = unit.player.side;
		if (side == 1) { textcolor = "green"; }
		
		c.moveTo(tx, ty);
		c.fillStyle = textcolor;
		c.fillRect  (tx, ty, textSize + 2, unitTextHeight); 
		if (unit.hasMoved)
			c.fillStyle = "2F4F4F"; //DarkSlateGrey
		else
			c.fillStyle = "white";
			
		c.fillText(text, tx, ty + 8);
		//draw indicator for unit.hasFired
		if (!unit.hasFired)
		{
			c.beginPath();
			c.arc(tx-5, ty + 5, 3, 0, Math.PI*2, false);
			c.fillStyle = "grey";
			c.strokeStyle = "crimson";
			c.lineWidth = 2;
			c.fill();
			c.stroke();
			c.closePath();
		}
	}
	
	function drawHexGrid(x0, y0, style)
	{
		c.lineWidth = style.lineWidth; 
		c.lineJoin = style.lineJoin; 
		c.strokeStyle = style.lineColor;
		c.beginPath();
		c.moveTo(x0, y0);
		c.lineTo(x0 + s, y0);
		c.lineTo(x0 + s + h, y0 + r);
		c.lineTo(x0 + s, y0 + 2 * r);
		c.lineTo(x0, y0 + 2 * r);
		c.lineTo(x0 - h, y0 + r);
		if (style.fillColor !== null) 
		{
			c.fillStyle = style.fillColor;
			c.fill();
		}
		c.closePath();
		c.stroke();
	}
}
