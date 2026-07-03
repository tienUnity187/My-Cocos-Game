//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
var maximize = false;

var portraitMode = false;
var landscapeMode = false;

var browserCanvas1 = document.querySelector(".browserCanvas1");
var browserBackground = document.querySelector(".browserBackground");
var gameCanvas = document.querySelector(".gameCanvas");
var browserCanvas2 = document.querySelector(".browserCanvas2");

var lastWidth = 0;
var lastHeight = 0;

var width2 = 0;
var height2 = 0;

var options = 0;

// Max Aspect Ratio
var maxAspectRatioWidth = 1;
var maxAspectRatioHeight = 1;

// Min Aspect Ratio
var minAspectRatioWidth = 1;
var minAspectRatioHeight = 1;

// Fixed Aspect Ratio
var fixedAspectRatioWidth = 16;
var fixedAspectRatioHeight = 9;

var browserCanvas1 = document.querySelector(".browserCanvas1")
style = window.getComputedStyle(browserCanvas1),
widthstr = style.getPropertyValue('width');
heightstr = style.getPropertyValue('height');

width2 = parseInt(widthstr.replace(/px/g, ""));
height2 = parseInt(heightstr.replace(/px/g, ""));

f1();

window.addEventListener('resize', resize2);

checkOrientationMode();

setInterval1 = setInterval(() =>
{
    checkOrientationMode();
}, 200);


const worker = new Worker('Template/worker.js');
//worker.postMessage('start');

worker.onmessage = (e) => {
		//console.log('main onmessage', e.data)
		applicationInstance.SendMessage("@ExternalUpdateManager", "UpdateFromWorker", 0.1);
	}

var isActive;

document.addEventListener('visibilitychange', function () {
if (document.visibilityState == "hidden") {
	applicationInstance.SendMessage("@ExternalUpdateManager", "OffVisibility");
} else {
	isActive = false;
	
	applicationInstance.SendMessage("@ExternalUpdateManager", "OnVisibility");
}
});


var deviceOrientation = "";

function checkOrientationMode()
{
    if (window.matchMedia("(orientation: landscape)").matches)
    {
        if(deviceOrientation != "landscape")
        {
            deviceOrientation = "landscape";
            resize2();
        }
    }
    else if (window.matchMedia("(orientation: portrait)").matches)
    {
        if(deviceOrientation != "portrait")
        {
            deviceOrientation = "portrait";
            resize2();
        }
    }
}

function resize2() {
    f1();
}

function getScale() {
    var widthScale = $(browserBackground).width() / width2;
    var heightScale = $(browserBackground).height() / height2;
    return Math.min(widthScale, heightScale);
};

function getScale2() {
    var widthScale = $(window).width() / width;
    var heightScale = $(window).height() / height;
    return Math.min(widthScale, heightScale);
};

function f1() {

    if((($(window).height() / $(window).width()) > (this.maxAspectRatioHeight / this.maxAspectRatioWidth)) && (this.options==1 || this.options==3))
    {
        width = this.maxAspectRatioWidth;
        height = this.maxAspectRatioHeight;

        maximize = false;
    }
    else if((($(window).height() / $(window).width()) < (this.minAspectRatioHeight / this.minAspectRatioWidth)) && (this.options==2 || this.options==3))
    {
        width = this.minAspectRatioWidth;
        height = this.minAspectRatioHeight;

        maximize = false;
    }
	else if (options==0)
    {
        width = this.fixedAspectRatioWidth;
        height = this.fixedAspectRatioHeight;

        maximize = false;
    }
    else
    {
        maximize = true;
        browserCanvas2.style.height = "100%";
        browserCanvas2.style.width = "100%";
        browserBackground.style.height = "100%";
        browserBackground.style.width = "100%";
        gameCanvas.style.width = "100%";
        gameCanvas.style.height = "100%";
    }

    if(!maximize)
    {
        resize();
    }

    f2();

    if(($(browserBackground).height() / $(browserBackground).width()) > 1)
    {
        if (!portraitMode && !unityInstantiated)
        {
            //document.querySelector("#companyLogo").classList.remove("companyLogo");
            //document.querySelector("#companyLogo").classList.add("companyLogo_portraitMode");

            //document.querySelector("#fullscreenButton").style.bottom = "auto";

            portraitMode = true;
            landscapeMode = false;
        }
    }
    else
    {
        if (!landscapeMode && !unityInstantiated)
        {
            //document.querySelector("#companyLogo").classList.add("companyLogo");
            //document.querySelector("#companyLogo").classList.remove("companyLogo_portraitMode");

            //document.querySelector("#fullscreenButton").style.bottom = "0";

            landscapeMode = true;
            portraitMode = false;
        }
    }
}

function f2()
{
    var agw = Math.sqrt(browserCanvas2.clientWidth * browserCanvas2.clientHeight) / 100;
    
    var var1 = 1.5;
    var agv = Math.sqrt($(window).width() * $(window).height()) / (100 * var1);

    document.documentElement.style.setProperty('--agw', `${agw}px`);
    document.documentElement.style.setProperty('--agwww', `${agw}`);
    document.documentElement.style.setProperty('--agv', `${agv}px`);
}

function resize() {
    var scale = getScale2();

    browserBackground.style.height = height * scale + "px";
    browserBackground.style.width = width * scale + "px";

    gameCanvas.style.height = height * scale + "px";
    gameCanvas.style.width = width * scale + "px";
    
    browserCanvas2.style.height = height * scale + "px";
    browserCanvas2.style.width = width * scale + "px";
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
function request_fullscreen () {
    $(document).ready(function()
    {
          var el = document.querySelector("body");

          var entered;
          entered = el.requestFullscreen ? (el.requestFullscreen(),
          true) : el.msRequestFullscreen ? (el.msRequestFullscreen(),
          true) : el.mozRequestFullScreen ? (el.mozRequestFullScreen(),
          true) : el.webkitRequestFullscreen ? (el.webkitRequestFullscreen(Element.ALLOW_KEYBOARD_INPUT),
          true) : false;
    });
	
	setTimeout(function () {
		window.screen.orientation.lock('portrait-primary').then(function() {
		console.log('lock success');
		}).catch(function() {
		console.log('could not lock');
		});
	}, 100);
	
	setTimeout(function () {
		window.screen.orientation.lock('landscape-primary').then(function() {
		console.log('lock success');
		}).catch(function() {
		console.log('could not lock');
		});
	}, 300);
  }
  
  function is_fullscreen() {
          return !(!document.fullscreenElement && !document.mozFullScreenElement && !document.webkitFullscreenElement && !document.msFullscreenElement)
  }

  function exit_fullscreen() {	 
	setTimeout(function () {
		window.screen.orientation.lock('portrait-primary').then(function() {
		console.log('lock success');
		}).catch(function() {
		console.log('could not lock');
		});
	}, 0);
	
	setTimeout(function () {		
		if (document.exitFullscreen) {
		   document.exitFullscreen()
		} else if (document.msExitFullscreen) {
		   document.msExitFullscreen()
		} else if (document.mozCancelFullScreen) {
		   document.mozCancelFullScreen()
		} else if (document.webkitExitFullscreen) {
		   document.webkitExitFullscreen()
		}
	}, 100);
  }

/*
  function toggle_fullscreen() {
          if (is_fullscreen()) {
              exit_fullscreen();
          } else {
              request_fullscreen();
          }
  }
*/
