import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { fieldTypes, handlerMethods, initComponentsBody, isGenerated } from "../plugins/input-swing/parse.js";
import { lowerForm } from "../plugins/input-swing/lower.js";
import { detectDialect } from "../plugins/dsp-ir/ir.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * A NetBeans style GUI builder never hand writes initComponents; it
 * regenerates the whole method from the form it holds, in the same shapes
 * every time: a field instantiated, a caption set with a literal, an event
 * wired through an anonymous ActionListener that calls straight through to
 * the real handler. input-swing finds the method by the GEN-BEGIN/GEN-END or
 * editor fold markers the builder brackets it with, cuts it into statements
 * with a scanner that knows Java's strings and comments, and lowers each
 * shape onto the AngularJS attribute dialect the rest of the tool already
 * reads, the way input-winforms already lowers a designer file's
 * InitializeComponent. What the generated code cannot say honestly, a
 * caption built at runtime, a combo box filled by code, a statement this
 * reader does not recognise, is named through ctx.unverified rather than
 * guessed at, and a handler's own body is never read past where it starts
 * and ends.
 */

/** Read a small in memory .java source into the pieces lowerForm needs. */
function read(source) {
  const body = initComponentsBody(source);
  return { body, form: { statements: body?.statements ?? [], fieldTypes: fieldTypes(source), handlers: handlerMethods(source) } };
}

const HAPPY = `
public class LoginForm extends javax.swing.JFrame {
    private javax.swing.JLabel usernameLabel;
    private javax.swing.JTextField usernameField;
    private javax.swing.JPasswordField passwordField;
    private javax.swing.JCheckBox rememberCheckBox;
    private javax.swing.JComboBox roleComboBox;
    private javax.swing.JButton loginButton;

    // <editor-fold defaultstate="collapsed" desc="Generated Code">//GEN-BEGIN:initComponents
    private void initComponents() {

        usernameLabel = new javax.swing.JLabel();
        usernameField = new javax.swing.JTextField();
        passwordField = new javax.swing.JPasswordField();
        rememberCheckBox = new javax.swing.JCheckBox();
        roleComboBox = new javax.swing.JComboBox();
        loginButton = new javax.swing.JButton();

        usernameLabel.setText("Username");
        usernameLabel.setLabelFor(usernameField);

        rememberCheckBox.setText("Remember me");

        roleComboBox.addItem("Administrator");
        roleComboBox.addItem("Clerk");

        loginButton.setText("Log in");
        loginButton.addActionListener(new java.awt.event.ActionListener() {
            public void actionPerformed(java.awt.event.ActionEvent evt) {
                loginButtonActionPerformed(evt);
            }
        });

        pack();
    }// </editor-fold>//GEN-END:initComponents

    private void loginButtonActionPerformed(java.awt.event.ActionEvent evt) {
        String user = usernameField.getText();
        char[] pass = passwordField.getPassword();
        AuthService.authenticate(user, pass, roleComboBox.getSelectedItem());
        System.out.println("never read: " + user);
    }
}
`;

test("isGenerated claims a file only by its GEN markers", () => {
  assert.equal(isGenerated(HAPPY), true);
  assert.equal(isGenerated("public class Plain { void initComponents() { doStuff(); } }"), false, "a hand written method with no builder markers is not this reader's");
});

test("a NetBeans form lowers onto the dialect: fields declared, a label paired, a checkbox, a combo box, a wired button", () => {
  const { body, form } = read(HAPPY);
  assert.ok(body.marked, "the GEN markers were found");
  assert.equal(body.closed, true);
  const notes = [];
  const lowered = lowerForm(form, (n) => notes.push(n));

  assert.match(lowered.template, /<label for="f-username">Username<\/label>/);
  assert.match(lowered.template, /<input id="f-username" type="text" ng-model="username">/);
  assert.match(lowered.template, /<input id="f-passwordfield" type="password" ng-model="passwordField">/);
  assert.match(lowered.template, /<label><input type="checkbox" ng-model="rememberMe"> Remember me<\/label>/);
  assert.match(lowered.template, /<option>Administrator<\/option>/);
  assert.match(lowered.template, /<option>Clerk<\/option>/);
  assert.match(lowered.template, /<button type="button" ng-click="onLoginButton\(\)">Log in<\/button>/);
  assert.deepEqual(lowered.outputs, ["loginButton"]);
  assert.deepEqual(lowered.fields.sort(), ["passwordField", "rememberMe", "roleComboBox", "username"]);
  assert.equal(detectDialect(lowered.template).name, "angularjs", "the lowering is read as the dialect it targets");

  // The handler exists on the record, and never as its own source.
  assert.ok(notes.some((n) => /loginButtonActionPerformed exists, \d+ line\(s\) long/.test(n)));
  for (const n of notes) assert.doesNotMatch(n, /AuthService|getPassword|getSelectedItem|System\.out/, "the handler body never reaches a note");
  assert.doesNotMatch(lowered.template, /AuthService|getPassword|System\.out/, "the handler body never reaches the template");
});

test("a setText call whose argument is not a plain string literal is named, never guessed at", () => {
  const src = `
    public class Weird extends javax.swing.JFrame {
      private javax.swing.JLabel messageLabel;
      // <editor-fold desc="Generated Code">//GEN-BEGIN:initComponents
      private void initComponents() {
        messageLabel = new javax.swing.JLabel();
        messageLabel.setText(buildGreeting());
      }// </editor-fold>//GEN-END:initComponents
    }
  `;
  const { form } = read(src);
  const notes = [];
  const lowered = lowerForm(form, (n) => notes.push(n));
  assert.ok(notes.some((n) => /messageLabel\.setText\(\.\.\.\) is not a plain string literal/.test(n)));
  assert.doesNotMatch(lowered.template, /buildGreeting/, "a dynamic caption is never printed as if it were the text itself");
});

test("a combo box item read from a variable is named as a gap, and the box is taken as filled at runtime", () => {
  const src = `
    public class Weird extends javax.swing.JFrame {
      private javax.swing.JComboBox regionComboBox;
      // <editor-fold desc="Generated Code">//GEN-BEGIN:initComponents
      private void initComponents() {
        regionComboBox = new javax.swing.JComboBox();
        regionComboBox.addItem(regionName);
      }// </editor-fold>//GEN-END:initComponents
    }
  `;
  const { form } = read(src);
  const notes = [];
  const lowered = lowerForm(form, (n) => notes.push(n));
  assert.ok(notes.some((n) => /regionComboBox\.addItem\(\.\.\.\) argument is not a plain string literal/.test(n)));
  assert.ok(notes.some((n) => /the combo box regionComboBox is filled by code at runtime/.test(n)));
  assert.match(lowered.template, /ng-repeat="option in regionComboBoxOptions"/);
  assert.doesNotMatch(lowered.template, /regionName/, "the unresolved argument is never printed into the template");
});

test("a statement this reader does not classify is named with its own line number, never silently dropped", () => {
  const src = `
    public class Weird extends javax.swing.JFrame {
      private javax.swing.JLabel weirdWidget;
      // <editor-fold desc="Generated Code">//GEN-BEGIN:initComponents
      private void initComponents() {
        weirdWidget = new javax.swing.JLabel();
        doSomethingOdd(weirdWidget, 42);
      }// </editor-fold>//GEN-END:initComponents
    }
  `;
  const { body, form } = read(src);
  const oddLine = body.statements.find((s) => s.text.startsWith("doSomethingOdd")).line;
  const notes = [];
  lowerForm(form, (n) => notes.push(n));
  assert.ok(notes.some((n) => n.includes(`line ${oddLine}`) && n.includes("doSomethingOdd") && n.includes("not a statement shape this reader classifies")));
});

test("a Swing login form ports to React through the unchanged pipeline", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/swing") });
  try {
    assert.equal(run.error, null);
    const screen = run.ctx.screens.find((s) => s.readBy === "swing");
    assert.ok(screen, "the Swing form was read");
    assert.deepEqual(screen.outputs, ["loginButton"]);

    const jsx = await readFile(join(run.out, "src/features", screen.className, `${screen.className}.jsx`), "utf8");
    assert.match(jsx, /ng-model|value=\{username\}/, "the field survived the port in some recognisable form");
    assert.match(jsx, /onChange=\{\(event\) => setUsername\(event\.target\.value\)\}/);
    assert.match(jsx, /<option>\s*Administrator\s*<\/option>/);
    // templateOrigin says which method and file it came from, in prose; that is provenance, not syntax.
    assert.doesNotMatch(jsx, /javax\.swing|ActionListener|GEN-BEGIN/, "no Swing syntax survived into the port");
    assert.doesNotMatch(jsx, /AuthService|getPassword|getSelectedItem|System\.out/, "the handler's own body never reaches the port");

    const notes = run.ctx.report.unverified.join("\n");
    assert.doesNotMatch(notes, /AuthService|getPassword|getSelectedItem|System\.out/, "the handler body is never quoted in the notes either");

    const swingMd = await readFile(join(run.out, "SWING.md"), "utf8");
    assert.match(swingMd, /LoginForm/);
    assert.doesNotMatch(swingMd, /AuthService|getPassword|getSelectedItem|System\.out/);
  } finally {
    await run.cleanup();
  }
});
