package com.example.client;

import com.google.gwt.core.client.GWT;
import com.google.gwt.event.dom.client.ClickEvent;
import com.google.gwt.uibinder.client.UiBinder;
import com.google.gwt.uibinder.client.UiField;
import com.google.gwt.uibinder.client.UiHandler;
import com.google.gwt.user.client.Window;
import com.google.gwt.user.client.ui.Button;
import com.google.gwt.user.client.ui.CheckBox;
import com.google.gwt.user.client.ui.Composite;
import com.google.gwt.user.client.ui.ListBox;
import com.google.gwt.user.client.ui.PasswordTextBox;
import com.google.gwt.user.client.ui.TextBox;
import com.google.gwt.user.client.ui.Widget;

public class Login extends Composite {

  interface LoginUiBinder extends UiBinder<Widget, Login> {}
  private static LoginUiBinder uiBinder = GWT.create(LoginUiBinder.class);

  @UiField TextBox usernameBox;
  @UiField PasswordTextBox passwordBox;
  @UiField CheckBox rememberBox;
  @UiField ListBox roleList;
  @UiField Button loginButton;

  public Login() {
    initWidget(uiBinder.createAndBindUi(this));
  }

  // The handler's own logic never reaches the port; only that it exists, and how long it runs.
  @UiHandler("loginButton")
  void onLogin(ClickEvent event) {
    String username = usernameBox.getText();
    String secret = "do-not-print-me";
    Window.alert("logging in " + username + secret);
  }
}
