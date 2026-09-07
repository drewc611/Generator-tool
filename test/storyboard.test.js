import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { parseStoryboard, scenesOf, seguesOf } from "../plugins/input-storyboard/parse.js";
import { lowerScene } from "../plugins/input-storyboard/lower.js";
import { detectDialect } from "../plugins/dsp-ir/ir.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * Apple Interface Builder's `.storyboard` and `.xib` files, the declarative
 * XML UI format UIKit and AppKit apps have shared since Xcode 4. A scene's
 * own `<view>` tree is a real component boundary somebody drew with
 * Interface Builder, so this reader lowers it onto the AngularJS attribute
 * dialect the rest of the tool already reads, the same target every desktop
 * form reader lowers onto.
 */

function lowerFirstScene(src, rel) {
  const doc = parseStoryboard(src);
  const [{ sceneId, objectsEl }] = scenesOf(doc);
  return lowerScene(objectsEl, sceneId, rel);
}

test("a login scene lowers onto the dialect the tool already reads", () => {
  const src = `<?xml version="1.0" encoding="UTF-8"?>
  <document type="com.apple.InterfaceBuilder3.CocoaTouch.Storyboard.XIB" version="3.0" toolsVersion="21701" targetRuntime="iOS.CocoaTouch">
   <scenes>
    <scene sceneID="abc-de-fgh">
     <objects>
      <viewController id="BYZ-38-t0r" customClass="LoginViewController" customModule="MyApp" sceneMemberID="viewController">
       <view key="view" id="8bC-Xf-vdC">
        <subviews>
         <label opaque="NO" text="Username" id="lbl1"/>
         <textField opaque="NO" id="usernameField"/>
         <textField opaque="NO" secureTextEntry="YES" id="passwordField"/>
         <switch opaque="NO" on="YES" id="rememberSwitch"/>
         <label text="Remember me" id="lbl2"/>
         <segmentedControl id="roleSegment">
          <segments>
           <segment title="Administrator"/>
           <segment title="User"/>
          </segments>
         </segmentedControl>
         <button opaque="NO" id="loginButton">
          <state key="normal" title="Login"/>
          <connections>
           <action selector="loginButtonTapped:" destination="BYZ-38-t0r" eventType="touchUpInside" id="conn2"/>
          </connections>
         </button>
        </subviews>
       </view>
      </viewController>
      <placeholder placeholderIdentifier="IBFirstResponder" id="dEy-fh-9qN" userLabel="First Responder" sceneMemberID="firstResponder"/>
     </objects>
    </scene>
   </scenes>
  </document>`;

  const doc = parseStoryboard(src);
  assert.ok(doc, "the <document> root element was read");
  const lowered = lowerFirstScene(src, "Login.storyboard");
  assert.equal(lowered.className, "LoginViewController");
  assert.match(lowered.template, /<p>Username<\/p>/);
  assert.match(lowered.template, /<input id="f-usernameField" type="text" ng-model="usernameField">/);
  assert.match(lowered.template, /<input id="f-passwordField" type="password" ng-model="passwordField">/);
  assert.match(lowered.template, /<label><input id="f-rememberSwitch" type="checkbox" ng-model="rememberSwitch"> Remember me<\/label>/);
  assert.match(lowered.template, /<option>Administrator<\/option>/);
  assert.match(lowered.template, /<option>User<\/option>/);
  assert.match(lowered.template, /<button type="button" ng-click="onLoginButtonTapped\(\)">Login<\/button>/);
  assert.deepEqual(lowered.outputs, ["loginButtonTapped"]);
  assert.deepEqual(lowered.fields.sort(), ["passwordField", "rememberSwitch", "roleSegment", "usernameField"]);
  assert.equal(detectDialect(lowered.template).name, "angularjs", "the lowering is read as the dialect it targets");
});

test("a segmented control with no inline segments is named as a gap the port must be handed", () => {
  const src = `<document><scenes><scene sceneID="s1"><objects>
   <viewController id="vc1" customClass="Prefs">
    <view key="view" id="v1"><subviews>
     <segmentedControl id="roleSegment"/>
    </subviews></view>
   </viewController>
  </objects></scene></scenes></document>`;
  const lowered = lowerFirstScene(src, "Prefs.storyboard");
  assert.equal(lowered.usesNgFor, true);
  assert.match(lowered.template, /ng-repeat="option in roleSegmentOptions"/);
  assert.ok(lowered.notes.some((n) => /roleSegment.*no inline segments/.test(n)));
});

test("a button with no matching touchUpInside action is emitted with the gap named", () => {
  const src = `<document><scenes><scene sceneID="s1"><objects>
   <viewController id="vc1" customClass="Prefs">
    <view key="view" id="v1"><subviews>
     <button id="cancelButton"><state key="normal" title="Cancel"/></button>
    </subviews></view>
   </viewController>
  </objects></scene></scenes></document>`;
  const lowered = lowerFirstScene(src, "Prefs.storyboard");
  assert.deepEqual(lowered.outputs, []);
  assert.match(lowered.template, /<button type="button">Cancel<\/button>/);
  assert.doesNotMatch(lowered.template, /ng-click/);
  assert.ok(lowered.notes.some((n) => /cancelButton.*no action connection wired/.test(n)));
});

test("a button wired to an event other than touchUpInside is emitted with the gap named", () => {
  const src = `<document><scenes><scene sceneID="s1"><objects>
   <viewController id="vc1" customClass="Prefs">
    <view key="view" id="v1"><subviews>
     <button id="hintButton">
      <state key="normal" title="Hint"/>
      <connections><action selector="onLongPress:" destination="vc1" eventType="touchDown" id="c1"/></connections>
     </button>
    </subviews></view>
   </viewController>
  </objects></scene></scenes></document>`;
  const lowered = lowerFirstScene(src, "Prefs.storyboard");
  assert.deepEqual(lowered.outputs, []);
  assert.doesNotMatch(lowered.template, /ng-click/);
  assert.ok(lowered.notes.some((n) => /hintButton.*wired to `touchDown`, not touchUpInside/.test(n)));
});

test("an unrecognised element is named rather than approximated", () => {
  const src = `<document><scenes><scene sceneID="s1"><objects>
   <viewController id="vc1" customClass="Prefs">
    <view key="view" id="v1"><subviews>
     <slider id="volumeSlider"/>
     <visualEffectView id="blur" customClass="UIVisualEffectView"><subviews>
      <label text="hidden" id="hiddenLabel"/>
     </subviews></visualEffectView>
    </subviews></view>
   </viewController>
  </objects></scene></scenes></document>`;
  const lowered = lowerFirstScene(src, "Prefs.storyboard");
  assert.ok(lowered.notes.some((n) => /the element `<slider>` \(volumeSlider\) is not lowered/.test(n)));
  assert.ok(lowered.notes.some((n) => /the element `<visualeffectview>` \(customClass `UIVisualEffectView`\) \(blur\) is not lowered; 1 child widget\(s\) inside it were not read either/.test(n)));
  assert.doesNotMatch(lowered.template, /hidden|slider|visualEffectView/i);
});

test("an image view is named as existing and never rendered", () => {
  const src = `<document><scenes><scene sceneID="s1"><objects>
   <viewController id="vc1" customClass="Prefs">
    <view key="view" id="v1"><subviews>
     <imageView id="logo" image="logo.png"/>
    </subviews></view>
   </viewController>
  </objects></scene></scenes></document>`;
  const lowered = lowerFirstScene(src, "Prefs.storyboard");
  assert.doesNotMatch(lowered.template, /img|image/i);
  assert.ok(lowered.notes.some((n) => /logo.*is an image view.*named as existing and not rendered/.test(n)));
  assert.doesNotMatch(lowered.notes.join(" "), /logo\.png/, "the image's own source is never printed");
});

test("a tableView is a header only structural placeholder, named as a gap", () => {
  const src = `<document><scenes><scene sceneID="s1"><objects>
   <viewController id="vc1" customClass="Prefs">
    <view key="view" id="v1"><subviews>
     <tableView id="rowsTable"/>
    </subviews></view>
   </viewController>
  </objects></scene></scenes></document>`;
  const lowered = lowerFirstScene(src, "Prefs.storyboard");
  assert.match(lowered.template, /<table><\/table>/);
  assert.ok(lowered.notes.some((n) => /rowsTable.*is a `tableview`.*header only structural placeholder/.test(n)));
});

test("a multi scene storyboard produces one screen per scene", () => {
  const src = `<document><scenes>
   <scene sceneID="s1"><objects>
    <viewController id="vc1" customClass="LoginViewController">
     <view key="view" id="v1"><subviews><label text="Sign in" id="l1"/></subviews></view>
    </viewController>
   </objects></scene>
   <scene sceneID="s2"><objects>
    <viewController id="vc2" customClass="HomeViewController">
     <view key="view" id="v2"><subviews><label text="Welcome" id="l2"/></subviews></view>
    </viewController>
   </objects></scene>
  </scenes></document>`;
  const doc = parseStoryboard(src);
  const entries = scenesOf(doc);
  assert.equal(entries.length, 2);
  const scenes = entries.map(({ sceneId, objectsEl }) => lowerScene(objectsEl, sceneId, "App.storyboard"));
  assert.deepEqual(scenes.map((s) => s.className), ["LoginViewController", "HomeViewController"]);
  assert.match(scenes[0].template, /<p>Sign in<\/p>/);
  assert.match(scenes[1].template, /<p>Welcome<\/p>/);
});

test("a scene with no customClass falls back to a name generated from its own sceneID", () => {
  const src = `<document><scenes><scene sceneID="Xyz-99-qqq"><objects>
   <viewController id="vc1">
    <view key="view" id="v1"><subviews/></view>
   </viewController>
  </objects></scene></scenes></document>`;
  const lowered = lowerFirstScene(src, "Untitled.storyboard");
  assert.equal(lowered.className, "Xyz-99-qqq");
});

test("a segue is named as the navigation it is, never wired", () => {
  const src = `<document><scenes>
   <scene sceneID="s1"><objects>
    <viewController id="vc1" customClass="LoginViewController">
     <view key="view" id="v1"><subviews>
      <button id="loginButton">
       <state key="normal" title="Login"/>
       <connections>
        <segue destination="vc2" kind="show" identifier="toHome" id="seg1"/>
       </connections>
      </button>
     </subviews></view>
    </viewController>
   </objects></scene>
   <scene sceneID="s2"><objects>
    <viewController id="vc2" customClass="HomeViewController">
     <view key="view" id="v2"><subviews/></view>
    </viewController>
   </objects></scene>
  </scenes></document>`;
  const doc = parseStoryboard(src);
  const segues = seguesOf(doc);
  assert.equal(segues.length, 1);
  assert.doesNotMatch(segues[0].tag, /LoginViewController/);
  // The button carries no ng-click for the segue: navigation is named, never wired.
  const entries = scenesOf(doc);
  const login = lowerScene(entries[0].objectsEl, entries[0].sceneId, "App.storyboard");
  assert.doesNotMatch(login.template, /ng-click/);
});

test("a .xib with no <scene> wrapper reads through the same vocabulary", () => {
  const src = `<?xml version="1.0" encoding="UTF-8"?>
  <document type="com.apple.InterfaceBuilder3.Cocoa.XIB" version="3.0" toolsVersion="21701" targetRuntime="MacOSX.Cocoa">
   <objects>
    <placeholder placeholderIdentifier="IBFilesOwner" id="-1" userLabel="File's Owner"/>
    <placeholder placeholderIdentifier="IBFirstResponder" id="-2" customClass="FirstResponder"/>
    <view contentMode="scaleToFill" id="rootView">
     <subviews>
      <label text="Standalone" id="l1"/>
      <textField id="onlyField"/>
      <button id="okButton">
       <state key="normal" title="OK"/>
       <connections><action selector="okTapped:" destination="-1" eventType="touchUpInside" id="c1"/></connections>
      </button>
     </subviews>
    </view>
   </objects>
  </document>`;
  const doc = parseStoryboard(src);
  assert.ok(doc, "the <document> root element was read even with no <scenes> wrapper");
  const entries = scenesOf(doc);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].sceneId, null, "a xib has no sceneID of its own");
  const lowered = lowerScene(entries[0].objectsEl, entries[0].sceneId, "Standalone.xib");
  assert.match(lowered.template, /<p>Standalone<\/p>/);
  assert.match(lowered.template, /<input id="f-onlyField" type="text" ng-model="onlyField">/);
  assert.match(lowered.template, /<button type="button" ng-click="onOkTapped\(\)">OK<\/button>/);
  assert.deepEqual(lowered.outputs, ["okTapped"]);
  // The two placeholder bookkeeping objects are skipped silently, not named as gaps.
  assert.equal(lowered.notes.length, 0);
});

test("an Interface Builder login scene ports to React through the unchanged pipeline", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/storyboard") });
  try {
    assert.equal(run.error, null);
    const screen = run.ctx.screens.find((s) => s.readBy === "storyboard");
    assert.ok(screen, "the Interface Builder scene was read");
    assert.deepEqual(screen.outputs, ["loginButtonTapped"]);

    const jsx = await readFile(join(run.out, `src/features/${screen.className}/${screen.className}.jsx`), "utf8");
    assert.match(jsx, /ng-model|value=\{usernameField\}/, "the field survived the port in some recognisable form");
    assert.match(jsx, /onChange=\{\(event\) => setUsernameField\(event\.target\.value\)\}/);
    assert.match(jsx, /type="password"/);
    assert.match(jsx, /<option>\s*Administrator\s*<\/option>/);
    assert.doesNotMatch(
      jsx,
      /<viewController|<subviews|<segmentedControl|secureTextEntry|loginButtonTapped:|customClass=/,
      "no Interface Builder XML or raw Objective-C\\/Swift selector syntax survived into the port",
    );

    const md = await readFile(join(run.out, "STORYBOARD.md"), "utf8");
    assert.match(md, /Login\.storyboard/);
    assert.match(md, /LoginViewController/);
    assert.doesNotMatch(md, /<viewController|<subviews|loginButtonTapped:/, "no raw XML or selector syntax reaches the report");
  } finally {
    await run.cleanup();
  }
});
