Ext.define("MyApp.view.Login", {
  extend: "Ext.form.Panel",
  title: "Sign in",
  items: [
    { xtype: "textfield", name: "username", fieldLabel: "Username", allowBlank: false },
    { xtype: "textfield", name: "password", fieldLabel: "Password", inputType: "password" },
    { xtype: "checkboxfield", fieldLabel: "Remember me", name: "remember" },
    {
      xtype: "combobox",
      fieldLabel: "Role",
      name: "role",
      // The store is defined right here, so its options are real data.
      store: {
        fields: ["value", "text"],
        data: [
          ["admin", "Administrator"],
          ["user", "User"]
        ]
      }
    },
    {
      xtype: "button",
      text: "Login",
      handler: function (btn) {
        var form = btn.up("form").getForm();
        Ext.Ajax.request({ url: "/api/login", params: form.getValues() });
      }
    }
  ]
});
