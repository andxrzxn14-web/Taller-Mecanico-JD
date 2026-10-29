import java.sql.Connection;

public class Main {

    public static void main(String[] args) {

        CConexion conexion = new CConexion();

        Connection cn = conexion.establecerConexion();

        if (cn != null) {
            System.out.println("La conexión funciona correctamente.");
        } else {
            System.out.println("La conexión falló.");
        }
    }
}