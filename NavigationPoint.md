NavigationPoint class necessary for creating an entryExitPoint in code.  Instantiate the class and pass the OL.Geometry.Point in the constructor then add the NavigationPoint object to the entryExitPoints array.

Example usage:

```javascript
var PlaceObject = require("Waze/Feature/Vector/Landmark");
var AddPlace = require("Waze/Action/AddLandmark");
var NewPlace = new PlaceObject();

NewPlace.geometry = new OL.Geometry.Point(longitude, latitude);
NewPlace.attributes.categories.push(category);

let eep = new NavigationPoint(new OL.Geometry.Point(longitude, latitude));
NewPlace.attributes.entryExitPoints.push(eep);

W.model.actionManager.add(new AddPlace(NewPlace));
```

The above example is for creating a Place via script.  The same can be done to modify an existing Place to add the entryExitPoint using the NavigationPoint class by utilizing the UpdateObject class and setting entryExitPoints to an array containing objects of the NavigationPoint class.

