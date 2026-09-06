package com.example.app;

/**
 * A form a NetBeans style GUI builder would have generated. initComponents
 * below is exactly the shape the builder writes: fields instantiated one per
 * line, a caption set with setText, a label paired to its field with
 * setLabelFor, a combo box filled with addItem, and a click wired through an
 * anonymous ActionListener that calls straight through to the real handler.
 * loginButtonActionPerformed is hand written code below the generated
 * method; its body reads other fields and calls AuthService, and none of
 * that is this reader's to read.
 */
public class LoginForm extends javax.swing.JFrame {

    public LoginForm() {
        initComponents();
    }

    // Variables declaration - do not modify//GEN-BEGIN:variables
    private javax.swing.JLabel usernameLabel;
    private javax.swing.JTextField usernameField;
    private javax.swing.JPasswordField passwordField;
    private javax.swing.JCheckBox rememberCheckBox;
    private javax.swing.JComboBox roleComboBox;
    private javax.swing.JButton loginButton;
    // End of variables declaration//GEN-END:variables

    /** This method is called from within the constructor to initialize the form. */
    // <editor-fold defaultstate="collapsed" desc="Generated Code">//GEN-BEGIN:initComponents
    private void initComponents() {

        usernameLabel = new javax.swing.JLabel();
        usernameField = new javax.swing.JTextField();
        passwordField = new javax.swing.JPasswordField();
        rememberCheckBox = new javax.swing.JCheckBox();
        roleComboBox = new javax.swing.JComboBox();
        loginButton = new javax.swing.JButton();

        setDefaultCloseOperation(javax.swing.WindowConstants.EXIT_ON_CLOSE);
        setTitle("Sign in");

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
        Object role = roleComboBox.getSelectedItem();
        AuthService.authenticate(user, pass, role);
        System.out.println("signing in " + user);
    }

    public static void main(String args[]) {
        java.awt.EventQueue.invokeLater(() -> new LoginForm().setVisible(true));
    }
}
